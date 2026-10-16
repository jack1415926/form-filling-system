"""Create filled test applications through the real submission/approval workflow."""
import uuid

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone
from rest_framework.test import APIClient

from changes.dispositions import LOCATIONS
from changes.ecr import ECR_ACTIONS
from changes.eco import ECO_ACTIONS
from changes.emc_views import matrix_data, persist
from changes.models import (
    ChangeRequest, EcrActionResponse, EcoActionResponse, ExecutionPlanResponse,
    MaterialChange, MaterialDisposition, QuestionResponse, SignificantAssessment,
    SignificantChartResponse,
)


STATES = {'draft': '草稿', 'reviewing': '审核中', 'pending_approval': '待批准',
          'approved': '已批准', 'published': '已发布'}

# One consistent synthetic scenario: revise an in-house part's controlled description,
# leaving its physical design, intended use, processes and supplier unchanged.
SAMPLE_REASON = '测试：自制非关键、非可追溯、非维修备件的连接件物料由A版升至B版，仅规范内部受控描述；实物、规格、用途及工艺不变，不涉及外购件或供应商。'
SAMPLE_ACTION_RESULTS = {
    '009': '测试：新旧物料实物规格相同，核对既有验证后确认可完全互换。',
    '010': '测试：未改变已销售产品，不涉及召回；无需更新维修手册或制定维修备件处置计划。',
    '011': '测试：库存实物未受影响，各处物料按No Change处理，无需返工或另编作业指导书。',
    '012': '测试：原材料及其化学成分未变，不需新增化学特性测试。',
    '013': '测试：未变更任何软件、配置或算法，不需更新软件文档或回归测试。',
    '014': '测试：接触人体的材料及应用方式未变，不需新增生物相容性或清洁验证。',
    '015': '测试：供应商及其资质范围未变，不需新增供应商或重新审核资质。',
    '016': '测试：认证范围及其受控要求未变，不需制定送测计划。',
    '017': '测试：制造与售后工艺未变，不需新增过程确认。',
    '018': '测试：供应商工艺未变，不需新增供应商过程确认。',
    '019': '测试：本合成场景设定不影响注册认证资料，无需更新Technical File或通知注册机构。',
}


class Command(BaseCommand):
    help = '新建填好的ECR/ECO测试数据（不修改现有申请，不创建或重置账号）。'

    def add_arguments(self, parser):
        parser.add_argument('--stage', choices=['ecr', 'eco', 'all'], required=True)
        parser.add_argument('--state', choices=[*STATES, 'all'], required=True)
        parser.add_argument('--applicant', required=True, help='已有有效账号的登录名')
        for role in ['reviewer', 'approver', 'publisher']:
            parser.add_argument('--' + role, help='登录名；默认使用申请人')

    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError('测试数据脚本仅允许在DJANGO_DEBUG=1的开发环境运行。')
        users = {}
        for role in ['applicant', 'reviewer', 'approver', 'publisher']:
            name = options[role] or options['applicant']
            try:
                users[role] = get_user_model().objects.get(username=name, is_active=True)
            except get_user_model().DoesNotExist:
                raise CommandError(f'{role}: 有效账号不存在：{name}') from None
        stages = ['ecr', 'eco'] if options['stage'] == 'all' else [options['stage']]
        users['reviewers'] = [users['reviewer']]
        users['approvers'] = [users['approver']]
        states = list(STATES) if options['state'] == 'all' else [options['state']]
        rows = []
        # A failed API operation must also roll back its source ECR and all filled sheets.
        with transaction.atomic():
            for stage in stages:
                for state in states:
                    record = self.create_scenario(stage, state, users, uuid.uuid4().hex[:12])
                    rows.append((record, state))
        self.stdout.write('已新建测试数据；重复运行会新增一批，不覆盖原数据。')
        for record, state in rows:
            source = f'，来源ECR #{record.source_ecr_id}' if record.source_ecr_id else ''
            self.stdout.write(f'{record.stage.upper()} #{record.pk} {STATES[state]} '
                              f'{record.eco_no or record.ecr_no}{source}')
        self.stdout.write('人员：' + ' / '.join(f'{role}={users[role].username}' for role in ['applicant', 'reviewer', 'approver', 'publisher']))

    @transaction.atomic
    def create_scenario(self, stage, state, users, token):
        record = self.create_ecr(token, users)
        if stage == 'eco':
            self.advance(record, 'published', users)
            response = self.request(users['applicant'], 'post', record, 'eco/',
                                    filler_id=users['applicant'].pk, request_id=str(uuid.uuid4()))
            record = ChangeRequest.objects.get(pk=response['change']['id'])
            record.eco_no = f'TEST-ECO-{token}'
            record.publisher = users['publisher']
            self.fill_actions(record, users['reviewers'])
        record.title = f'[测试] {stage.upper()} {STATES[state]} {token}'
        record.save()
        record.stage_approvers.set(users['approvers'])
        self.advance(record, state, users)
        return record

    def request(self, actor, method, record, suffix, **payload):
        client = APIClient()
        client.force_authenticate(actor)
        response = getattr(client, method)(f'/api/changes/{record.pk}/{suffix}', payload, format='json')
        if response.status_code not in [200, 201]:
            raise CommandError(f'{record.stage.upper()} {suffix} 失败 ({response.status_code}): {response.data}')
        return response.data

    def create_ecr(self, token, users):
        today = timezone.localdate()
        record = ChangeRequest.objects.create(
            applicant=users['applicant'], publisher=users['publisher'], stage='ecr',
            title=f'[测试] ECO来源ECR {token}', ecr_no=f'TEST-ECR-{token}',
            affected_products='测试产品 A', affected_region='中国', initiating_factory='测试工厂 A',
            affected_factories='测试工厂 A', ccb_owner='测试 CCB',
            change_owner=users['applicant'].get_full_name() or users['applicant'].username,
            planned_eco_date=today, change_reason=SAMPLE_REASON)
        record.stage_approvers.set(users['approvers'])
        QuestionResponse.objects.bulk_create([
            QuestionResponse(change=record, number=n, answer='Y' if n == 6 else 'N',
                             remark=SAMPLE_REASON if n == 6 else '测试场景：仅规范自制件内部受控描述，不改变实物、规格、用途、工艺及其他受控资料，不涉及外购件；本项不涉及。')
            for n in range(1, 28)])
        material = MaterialChange.objects.create(
            change=record, category='revision', material_no=f'TEST-PART-{token}',
            description='测试自制连接件', material_class='自制非关键物料', spare_part='N', optional_part='N',
            old_revision='A', new_revision='B', change_description=SAMPLE_REASON)
        MaterialDisposition.objects.bulk_create([
            MaterialDisposition(material=material, location_group=group, location_item=key,
                                disposition='No Change', remark='测试：现有物料无需处置')
            for key, group in LOCATIONS.items()])
        ExecutionPlanResponse.objects.create(change=record, activity_key='plan_002', owner=record.change_owner,
                                             start_date=today, end_date=today, remark='测试计划：核对既有验证覆盖，发布物料B版。')
        SignificantAssessment.objects.create(change=record, f_assessment='not_applicable', final_conclusion='non_significant')
        SignificantChartResponse.objects.bulk_create([
            SignificantChartResponse(change=record, chart_key=key, applicability='N',
                                     result='' if key == '0' else 'not_applicable',
                                     reason='合成测试场景：非纠正措施，未变更预期用途、实物设计或性能；按0→A→B路径评估。')
            for key in ['0', 'A', 'B']])
        matrix = matrix_data(record)
        # Question 7 is N: keep the reference template, with no selected tests or fabricated remarks.
        persist(record, matrix)
        self.fill_actions(record, users['reviewers'])
        return record

    def fill_actions(self, record, reviewers):
        definitions, model = (ECO_ACTIONS, EcoActionResponse) if record.stage == 'eco' else (ECR_ACTIONS, EcrActionResponse)
        yes = set(record.question_responses.filter(answer='Y').values_list('number', flat=True))
        for definition in definitions:
            if definition['number'] not in yes:
                continue
            row = model.objects.create(change=record, action_key=definition['id'], owner_user=reviewers[0],
                                       result=SAMPLE_ACTION_RESULTS.get(definition['id'][-3:], '测试：已完成本题对应行动的核对。'),
                                       status='not_applicable' if record.stage == 'eco' and definition['id'] != 'eco_009' else 'completed',
                                       date=timezone.localdate())
            row.owners.set(reviewers)

    def advance(self, record, state, users):
        if state == 'draft':
            return
        self.request(users['applicant'], 'post', record, 'stage-submission/',
                     request_id=str(uuid.uuid4()), expected_round=0)
        record.refresh_from_db()
        if state == 'reviewing':
            return
        for task in record.review_rounds.get(number=1).tasks.select_related('owner'):
            self.request(task.owner, 'post', record, f'action-tasks/{task.pk}/',
                         request_id=str(uuid.uuid4()), version=task.version)
        if state == 'pending_approval':
            return
        for approver in users['approvers']:
            self.request(approver, 'post', record, 'review-rounds/1/approve/', request_id=str(uuid.uuid4()))
        if state == 'published':
            self.request(users['publisher'], 'post', record, 'publication/', request_id=str(uuid.uuid4()), expected_round=1)
        record.refresh_from_db()
