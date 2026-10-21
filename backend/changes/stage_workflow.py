"""ECR/ECO按轮处理任务；所有写入必须先锁定所属申请。"""
from django.contrib.auth import get_user_model
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .dates import BusinessDateField
from .models import ActionTask, ChangeRequest, ReviewRecord, ReviewRound, TaskOperation
from .permissions import ExpectedAccountPermission
from .review_access import can_read_round, eligible, is_publication_reader, can_read_body, editable_change
from .review_issues import blockers
from .request_values import StrictValues, canonical, conflict
from .serializers import ChangeRequestSerializer
from .stage_actions import action_data, stage_parts, task_data


def approve_if_complete(record):
    # 任务、意见和全部批准条件共同决定是否获批；发布仍须指定发布人另行操作。
    if record.stage not in ['ecr', 'eco'] or record.status != 'pending':
        return
    round = record.review_rounds.get(number=record.current_review_round)
    if (round.tasks.filter(confirmed_at__isnull=True).exists() or record.review_issues.exclude(state='resolved').exists()
            or round.records.filter(approval_required=True, approved_at__isnull=True).exists()):
        return
    round.state = 'approved'; round.approved_at = timezone.now()
    round.save(update_fields=['state', 'approved_at'])
    record.status = 'approved'; record.updated_at = round.approved_at
    record.save(update_fields=['status', 'updated_at'])


def stage_data(record, actor):
    answers = dict(record.question_responses.values_list('number', 'answer'))
    round = record.review_rounds.filter(number=record.current_review_round).first()
    visible_rounds = [row.pk for row in record.review_rounds.all() if can_read_round(actor, row)]
    tasks = [task_data(task, actor, record) for task in ActionTask.objects.filter(round_id__in=visible_rounds).select_related('round', 'owner').prefetch_related('operations').order_by('round__number', 'action_key')]
    # 退回修订中的正文不向审核参与者开放，但已授权的历史任务仍可查看。
    body_visible = can_read_body(actor, record)
    actions = action_data(record, answers) if body_visible else []
    return {'actor_id': actor.pk, 'stage': record.stage, 'change': ChangeRequestSerializer(record).data if body_visible else None,
            'change_id': record.pk, 'updated_at': record.updated_at.isoformat(), 'status': record.status,
            'current_round': record.current_review_round, 'actions': actions, 'tasks': tasks,
            'unanswered': [number for number in range(1, 28) if answers.get(number) not in ['Y', 'N']] if body_visible else [],
            'issue_blockers': blockers(record) if record.applicant_id == actor.pk else [],
            'submission_requests': [str(value) for value in record.review_rounds.exclude(request_id=None).values_list('request_id', flat=True)] if record.applicant_id == actor.pk else [],
            'submission_request_id': str(round.request_id) if round and round.request_id else None}


class StageDetail(APIView):
    permission_classes = [IsAuthenticated, ExpectedAccountPermission]
    def get(self, request, pk):
        with transaction.atomic():
            record = get_object_or_404(ChangeRequest.objects.select_for_update(), pk=pk, stage__in=['ecr', 'eco'])
            if not can_read_body(request.user, record):
                round = record.review_rounds.filter(number=record.current_review_round).first()
                if round is None or not can_read_round(request.user, round):
                    return Response({'detail': '申请不存在或没有权限。'}, status=404)
            return Response(stage_data(record, request.user))


class StageSubmissionValues(StrictValues):
    request_id = serializers.UUIDField()
    expected_round = serializers.IntegerField(min_value=0)
    acknowledge_no_tasks = serializers.BooleanField(default=False)


class StageSubmission(APIView):
    permission_classes = [IsAuthenticated, ExpectedAccountPermission]
    def post(self, request, pk):
        serializer = StageSubmissionValues(data=request.data); serializer.is_valid(raise_exception=True)
        values = serializer.validated_data
        with transaction.atomic():
            record = editable_change(request, pk)
            if record.stage not in ['ecr', 'eco']: conflict('仅ECR／ECO支持阶段提交。')
            repeated = record.review_rounds.filter(request_id=values['request_id']).first()
            if repeated:
                if repeated.submission_payload != canonical(values):
                    conflict('相同请求标识的提交内容不同。')
                return Response(stage_data(record, request.user))
            if record.status not in ['draft', 'returned'] or record.current_review_round != values['expected_round']:
                conflict('阶段状态或轮次已变化，请刷新后核对。')
            data = stage_data(record, request.user)
            number_field = 'eco_no' if record.stage == 'eco' else 'ecr_no'
            errors = {field: '提交前必须填写。' for field in ['title', number_field] if not getattr(record, field).strip()}
            if data['unanswered']: errors['questions'] = '请回答全部27题。'
            if data['issue_blockers']: errors['issues'] = data['issue_blockers']
            _, _, relation = stage_parts(record)
            rows = {row.action_key: row for row in relation.all()}
            previous_tasks = {(task.action_key, task.owner_id): task for task in ActionTask.objects.filter(
                round__change=record, round__number=record.current_review_round)}
            required = [row for row in data['actions'] if row['required']]
            if any(not row['owner_active'] for row in required): errors['owners'] = '所有本轮行动都须指定有效负责人。'
            if not required and not values['acknowledge_no_tasks']: errors['tasks'] = '请明确确认本阶段无行动需处理。'
            # 锁住相关账号直到新轮次创建完成，避免校验有效后账号又被并发停用。
            approvers = set(record.stage_approvers.values_list('pk', flat=True))
            if not approvers: errors['stage_approver_ids'] = '请至少选择一位有效批准人。'
            ids = {pk for row in required for pk in row['owner_user_ids']} | approvers | {record.publisher_id}
            active = set(get_user_model().objects.select_for_update().filter(pk__in=[pk for pk in ids if pk], is_active=True).values_list('pk', flat=True))
            if record.publisher_id not in active: errors['publisher_id'] = '请选择有效发布人。'
            if any(pk not in active for row in required for pk in row['owner_user_ids']): errors['owners'] = '负责人账号已失效，请重新选择。'
            if not approvers.issubset(active): errors['stage_approver_ids'] = '批准人账号已失效，请重新选择。'
            if errors: raise serializers.ValidationError(errors)
            now = timezone.now()
            round = ReviewRound.objects.create(change=record, number=record.current_review_round + 1, review_mode='designated',
                request_id=values['request_id'], submission_payload=canonical(values), title=record.title, ecr_no=record.source_ecr.ecr_no if record.stage == 'eco' else record.ecr_no, eco_no=record.eco_no if record.stage == 'eco' else '', submitted_at=now)
            participants = {pk for row in required for pk in row['owner_user_ids']} | approvers
            # 人员改派后，原意见提出者仍负责复核本人未解决意见，不因此获得新任务权限。
            participants.update(record.review_issues.exclude(state='resolved').values_list('author_id', flat=True))
            ReviewRecord.objects.bulk_create([ReviewRecord(round=round, reviewer_id=pk, approval_required=pk in approvers) for pk in participants])
            tasks = []
            for row in required:
                for owner_id in row['owner_user_ids']:
                    # 只继承同一负责人的旧轮结果作为初值，不继承确认状态或其他人的结果。
                    previous = previous_tasks.get((row['id'], owner_id)) if record.current_review_round else rows[row['id']]
                    tasks.append(ActionTask(round=round, action_key=row['id'], owner_id=owner_id,
                        result=previous.result if previous else '', status=previous.status if previous else '',
                        date=previous.date if previous else None))
            ActionTask.objects.bulk_create(tasks)
            record.status = 'pending'; record.current_review_round = round.number; record.review_mode = 'designated'
            record.submitted_at = record.updated_at = now
            record.save(update_fields=['status', 'current_review_round', 'review_mode', 'submitted_at', 'updated_at'])
            from .round_snapshots import capture_form
            # 与任务创建同一事务内冻结完整表单，新一轮不能覆盖旧轮快照。
            round.form_snapshot = capture_form(record, round, request.user)
            round.save(update_fields=['form_snapshot'])
            approve_if_complete(record)
            return Response(stage_data(record, request.user))


class TaskValues(StrictValues):
    request_id = serializers.UUIDField()
    version = serializers.IntegerField(min_value=1)
    result = serializers.CharField(required=False, allow_blank=True)
    status = serializers.ChoiceField(choices=['', 'completed', 'not_applicable', 'implementation_stage'], required=False)
    date = BusinessDateField(required=False, allow_null=True)


class TaskDetail(APIView):
    permission_classes = [IsAuthenticated, ExpectedAccountPermission]
    def patch(self, request, pk, task_id):
        return self.write(request, pk, task_id, 'save')

    def post(self, request, pk, task_id):
        return self.write(request, pk, task_id, 'confirm')

    def write(self, request, pk, task_id, kind):
        serializer = TaskValues(data=request.data); serializer.is_valid(raise_exception=True)
        values = serializer.validated_data
        if kind == 'confirm' and set(values) - {'request_id', 'version'}:
            raise serializers.ValidationError('确认只接受版本及请求标识，请先保存结果。')
        with transaction.atomic():
            record = get_object_or_404(ChangeRequest.objects.select_for_update(), pk=pk, stage__in=['ecr', 'eco'])
            task = get_object_or_404(ActionTask.objects.select_related('round', 'owner'), pk=task_id, round__change=record, owner=request.user)
            receipt = task.operations.filter(author=request.user, request_id=values['request_id']).first()
            if receipt:
                if receipt.kind != kind or receipt.payload != canonical(values): conflict('同一请求标识的任务操作内容不同。')
                return Response(stage_data(record, request.user))
            if not task_data(task, request.user, record)['can_edit'] or task.version != values['version']:
                conflict('任务已确认、轮次已结束或版本已变化；请保留输入并核对。')
            if record.stage == 'ecr' and values.get('status') == 'implementation_stage':
                raise serializers.ValidationError({'status': 'ECR不支持在实施阶段完成状态。'})
            if not task.action_key.startswith(record.stage + '_'):
                conflict('任务不属于当前阶段。')
            if kind == 'confirm':
                if task.status == 'implementation_stage':
                    raise serializers.ValidationError('在实施阶段完成仅可保存，完成或不适用后才能确认。')
                if not task.result.strip() or not task.status or not task.date:
                    raise serializers.ValidationError('结果说明、业务状态及日期完整后才能确认，不适用也需说明原因。')
                task.confirmed_at = timezone.now()
            else:
                for field in ['result', 'status', 'date']:
                    if field in values: setattr(task, field, values[field])
                _, response_model, _ = stage_parts(record)
                if not task.round.tasks.filter(action_key=task.action_key).exclude(pk=task.pk).exists():
                    response_model.objects.filter(change=record, action_key=task.action_key).update(result=task.result, status=task.status, date=task.date)
            task.version += 1; task.save()
            TaskOperation.objects.create(task=task, author=request.user, request_id=values['request_id'], kind=kind, payload=canonical(values))
            record.updated_at = timezone.now(); record.save(update_fields=['updated_at'])
            approve_if_complete(record)
            return Response(stage_data(record, request.user))
