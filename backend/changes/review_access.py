from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import NotFound
from .models import ChangeRequest
from .roles import business_role


def is_owner(user, change):
    return change.applicant_id == user.pk


def is_ecr_coordinator(user, source):
    return user.is_active and source.stage == 'ecr' and source.status == 'published' and user.pk in [source.applicant_id, source.published_by_id]


def is_eco_coordinator(user, record):
    return record.stage == 'eco' and is_ecr_coordinator(user, record.source_ecr)


def editable_change(request, pk):
    record = get_object_or_404(ChangeRequest.objects.select_for_update(), pk=pk)
    if record.applicant_id != request.user.pk:
        if record.stage == 'eco' and (is_eco_coordinator(request.user, record) or record.filler_events.filter(previous_filler=request.user).exists()):
            from .review_issues import conflict
            conflict('ECO当前由其他人员填写。填写人已变更或你仅有查看权限；未保存输入仍保留，请核对。')
        raise NotFound('申请不存在或没有修改权限。')
    return record


def is_publication_reader(user, change):
    return user.is_active and change.stage in ['ecr', 'eco'] and change.status in ['approved', 'published'] and change.publisher_id == user.pk


def eligible(user, round):
    if not user.is_active:
        return False
    if round.change.stage in ['ecr', 'eco']:
        return round.records.filter(reviewer=user, assigned=True).exists()
    if user.pk == round.change.applicant_id:
        return False
    if round.review_mode == 'public':
        return business_role(user) == 'reviewer'
    return round.records.filter(reviewer=user, assigned=True).exists()


def can_read_round(user, round):
    if is_owner(user, round.change) or eligible(user, round) or is_publication_reader(user, round.change) or is_eco_coordinator(user, round.change) or is_ecr_coordinator(user, round.change):
        return True
    if round.review_mode == 'public':
        return False
    current = round.change.review_rounds.filter(number=round.change.current_review_round).first()
    return current is not None and eligible(user, current)


def can_read_body(user, record):
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
    assigned = Q(review_mode='designated', records__reviewer=user, records__assigned=True)
    return assigned | Q(review_mode='public') if business_role(user) == 'reviewer' else assigned
