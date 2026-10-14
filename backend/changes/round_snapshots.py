"""Immutable submitted body, separate from the revision and its live endpoints."""
import json

from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import NotFound
from rest_framework.renderers import JSONRenderer
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import ChangeRequest
from .review_access import is_owner, eligible, is_publication_reader, is_eco_coordinator, is_ecr_coordinator
from .serializers import ChangeRequestSerializer, MaterialChangeSerializer


def capture_form(record, round, actor):
    # Called inside the submission transaction while holding the parent lock.
    from .views import QuestionList, EcrActionList, EcoActionList
    from .emc_views import matrix_data
    from .execution_plan_views import ExecutionPlanDetail
    from .significant_change_views import SignificantChangeDetail
    from .stage_workflow import stage_data
    from .publication import BASE_FIELDS

    ecr = record.source_ecr if record.stage == 'eco' else record
    payload = {
        'version': 1, 'change_id': record.pk, 'number': round.number,
        'captured_at': round.submitted_at.isoformat(),
        'overview': ChangeRequestSerializer(record).data,
        'actions': stage_data(record, actor)['actions'],
        'source_overview': {field: getattr(ecr, field) for field in BASE_FIELDS} if record.stage == 'eco' else None,
        'sheets': {
            'materials': MaterialChangeSerializer(record.materials.order_by('pk').prefetch_related('dispositions'), many=True).data,
            'questions': QuestionList.data(record),
            'ecr': {**EcrActionList.data(ecr), **({'source_ecr_id': ecr.pk} if record.stage == 'eco' else {})},
            'eco': EcoActionList.data(record),
            'emc': {**matrix_data(record), 'updated_at': record.updated_at.isoformat(), 'can_fill': False},
            'execution_plan': ExecutionPlanDetail.data(record),
            'significant_change': SignificantChangeDetail.data(record),
        },
    }
    return json.loads(JSONRenderer().render(payload))


def can_read_snapshot(user, round):
    record = round.change
    # Metadata history may be shared with new participants; full old bodies require their own authorization.
    return user.is_active and record.stage in ['ecr', 'eco'] and (
        is_owner(user, record) or eligible(user, round) or is_publication_reader(user, record)
        or is_eco_coordinator(user, record) or is_ecr_coordinator(user, record))


class RoundFormSnapshot(APIView):
    http_method_names = ['get', 'head', 'options']

    def get(self, request, pk, number):
        from .stage_workflow import task_data

        with transaction.atomic():
            record = get_object_or_404(ChangeRequest.objects.select_for_update(), pk=pk)
            round = get_object_or_404(record.review_rounds, number=number)
            if not can_read_snapshot(request.user, round):
                raise NotFound('审核记录不存在或没有权限。')
            tasks = [{**task_data(task, request.user, record), 'can_edit': False, 'confirmed_requests': []}
                     for task in round.tasks.select_related('owner', 'round').prefetch_related('operations').order_by('action_key', 'owner_id')]
            return Response({'actor_id': request.user.pk, 'change_id': pk, 'number': number, 'snapshot': round.form_snapshot, 'tasks': tasks})
