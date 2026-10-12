from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import NotFound
from .models import ChangeRequest
from .roles import business_role


def is_owner(user, change):
    return change.applicant_id == user.pk


def eligible(user, round):
    if not user.is_active or user.pk == round.change.applicant_id:
        return False
    if round.review_mode == 'public':
        return business_role(user) == 'reviewer'
    return round.records.filter(reviewer=user, assigned=True).exists()


def can_read_round(user, round):
    if is_owner(user, round.change) or eligible(user, round):
        return True
    if round.review_mode == 'public':
        return False
    current = round.change.review_rounds.filter(number=round.change.current_review_round).first()
    return current is not None and eligible(user, current)


def readable_change(request, pk):
    record = get_object_or_404(ChangeRequest.objects.select_for_update(), pk=pk)
    if is_owner(request.user, record):
        return record
    round = record.review_rounds.filter(number=record.current_review_round).first()
    if record.status not in ['pending', 'approved'] or round is None or not eligible(request.user, round):
        raise NotFound('申请不存在或没有查看权限。')
    return record


def reviewer_rounds(user):
    if not user.is_active:
        return Q(pk__in=[])
    assigned = Q(review_mode='designated', records__reviewer=user, records__assigned=True)
    return assigned | Q(review_mode='public') if business_role(user) == 'reviewer' else assigned
