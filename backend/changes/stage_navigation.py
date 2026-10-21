"""阶段导航只展示已授权摘要，不因此开放关联流程的正文。"""
from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import NotFound
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import ChangeRequest
from .publication import BASE_FIELDS
from .review_access import can_read_body, can_read_round, is_ecr_coordinator


def stage_summary(record, stage, actor, source_brief=False):
    hidden = {'stage': stage, 'id': None, 'status': 'unavailable', 'number': None, 'current_round': None,
              'confirmed': None, 'total': None, 'approved_at': None, 'published_at': None, 'updated_at': None, 'can_open': False}
    if record is None:
        return {**hidden, 'status': 'not_created'}
    can_open = can_read_body(actor, record)
    if not can_open and not source_brief:
        return hidden
    round = record.review_rounds.filter(number=record.current_review_round).first() if can_open else None
    tasks = round.tasks.all() if round else None
    # 退回轮次保留为历史，不把旧轮任务完成数当作当前修订的进度。
    return {'stage': stage, 'id': record.pk, 'status': record.status,
            'number': record.ecr_no if stage == 'ecr' else record.eco_no,
            'current_round': record.current_review_round if can_open else None,
            'confirmed': tasks.filter(confirmed_at__isnull=False).count() if tasks is not None and record.status != 'returned' else 0 if can_open else None,
            'total': tasks.count() if tasks is not None and record.status != 'returned' else 0 if can_open else None,
            'approved_at': round.approved_at.isoformat() if round and round.approved_at else None,
            'published_at': record.published_at.isoformat() if record.published_at else None,
            'updated_at': record.updated_at.isoformat(), 'can_open': can_open}


class StageNavigation(APIView):
    def get(self, request, pk):
        with transaction.atomic():
            record = get_object_or_404(ChangeRequest.objects.select_for_update(), pk=pk, stage__in=['ecr', 'eco'])
            round = record.review_rounds.filter(number=record.current_review_round).first()
            body = can_read_body(request.user, record)
            if not body and (round is None or not can_read_round(request.user, round)):
                raise NotFound('申请不存在或没有权限。')
            source = record.source_ecr if record.stage == 'eco' else record
            eco = record if record.stage == 'eco' else ChangeRequest.objects.filter(source_ecr=source).first()
            ecr_summary = stage_summary(source, 'ecr', request.user, source_brief=record.stage == 'eco' and body)
            eco_summary = stage_summary(eco, 'eco', request.user)
            if eco is None and source.applicant_id != request.user.pk and not is_ecr_coordinator(request.user, source):
                eco_summary['status'] = 'unavailable'
            return Response({'actor_id': request.user.pk, 'current_change_id': record.pk,
                             'stages': [ecr_summary, eco_summary]})


class SourceEcr(APIView):
    def get(self, request, pk):
        with transaction.atomic():
            record = get_object_or_404(ChangeRequest.objects.select_for_update(), pk=pk, stage='eco')
            if not can_read_body(request.user, record):
                raise NotFound('申请不存在或没有权限。')
            source = record.source_ecr
            return Response({'actor_id': request.user.pk, 'eco_id': record.pk, 'source_ecr_id': source.pk,
                             'ecr_no': source.ecr_no, 'published_at': source.published_at.isoformat(),
                             'overview': {field: getattr(source, field) for field in BASE_FIELDS},
                             'can_open': can_read_body(request.user, source)})
