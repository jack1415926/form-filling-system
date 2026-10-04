from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import NotFound
from .models import ChangeRequest
from .roles import business_role


def is_owner(user, change):
    return business_role(user) == 'filler' and change.applicant_id == user.pk


def eligible(user, round):
    return (business_role(user) == 'reviewer' and user.pk != round.change.applicant_id
            and (round.review_mode == 'public' or round.records.filter(reviewer=user, assigned=True).exists()))


def can_read_round(user, round):
    if is_owner(user, round.change) or eligible(user, round):
        return True
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
    return Q(review_mode='public') | Q(records__reviewer=user, records__assigned=True)
