from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import NotFound
from .models import ChangeRequest
from .request_values import conflict


def is_owner(user, change):
    return change.applicant_id == user.pk


def is_ecr_coordinator(user, source):
    return user.is_active and source.stage == 'ecr' and source.status == 'published' and user.pk in [source.applicant_id, source.published_by_id]


def is_eco_coordinator(user, record):
    return record.stage == 'eco' and is_ecr_coordinator(user, record.source_ecr)


def editable_change(request, pk):
    # 先锁住父申请再核对当前填写人，避免交接与保存并发时旧填写人继续写入。
    record = get_object_or_404(ChangeRequest.objects.select_for_update(), pk=pk, stage__in=['ecr', 'eco'])
    if record.applicant_id != request.user.pk:
        if record.stage == 'eco' and (is_eco_coordinator(request.user, record) or record.filler_events.filter(previous_filler=request.user).exists()):
            conflict('ECO当前由其他人员填写。填写人已变更或你仅有查看权限；未保存输入仍保留，请核对。')
        raise NotFound('申请不存在或没有修改权限。')
    return record


def is_publication_reader(user, change):
    return user.is_active and change.stage in ['ecr', 'eco'] and change.status in ['approved', 'published'] and change.publisher_id == user.pk


def eligible(user, round):
    if not user.is_active or round.change.stage not in ['ecr', 'eco']:
        return False
    return round.records.filter(reviewer=user).exists()


def can_read_round(user, round):
    # 这里只判断轮次元数据与任务记录权限，完整历史正文另走can_read_snapshot。
    if round.change.stage not in ['ecr', 'eco']:
        return False
    if is_owner(user, round.change) or eligible(user, round) or is_publication_reader(user, round.change) or is_eco_coordinator(user, round.change) or is_ecr_coordinator(user, round.change):
        return True
    current = round.change.review_rounds.filter(number=round.change.current_review_round).first()
    return current is not None and eligible(user, current)


def can_read_body(user, record):
    if record.stage not in ['ecr', 'eco']:
        return False
    if is_owner(user, record) or is_publication_reader(user, record) or is_eco_coordinator(user, record) or is_ecr_coordinator(user, record):
        return True
    current = record.review_rounds.filter(number=record.current_review_round).first()
    return record.status in ['pending', 'approved', 'published'] and current is not None and eligible(user, current)


def readable_change(request, pk):
    record = get_object_or_404(ChangeRequest.objects.select_for_update(), pk=pk)
    if not can_read_body(request.user, record):
        raise NotFound('申请不存在或没有查看权限。')
    return record


def reviewer_rounds(user):
    if not user.is_active:
        return Q(pk__in=[])
    return Q(change__stage__in=['ecr', 'eco'], review_mode='designated', records__reviewer=user)
