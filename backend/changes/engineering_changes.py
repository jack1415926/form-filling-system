"""Group linked processes for navigation; grouping never grants body access."""
from django.db import transaction
from django.db.models import F, Q
from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import ChangeRequest
from .review_access import can_read_body, is_ecr_coordinator
from .stage_navigation import stage_summary


class EngineeringChanges(APIView):
    def get(self, request):
        workflow = request.query_params.get('workflow', 'all')
        state = request.query_params.get('state', 'all')
        if workflow not in ['all', 'ecr', 'eco']:
            raise serializers.ValidationError({'workflow': '请选择全部、ECR或ECO流程。'})
        if state not in ['all', *ChangeRequest.Status.values]:
            raise serializers.ValidationError({'state': '流程状态不合法。'})
        actor = request.user
        if not actor.is_active:
            return Response({'actor_id': actor.pk, 'items': []})
        with transaction.atomic():
            candidates = ChangeRequest.objects.filter(stage__in=['ecr', 'eco']).filter(
                Q(applicant=actor)
                | Q(stage='eco', source_ecr__status='published', source_ecr__applicant=actor)
                | Q(stage='eco', source_ecr__status='published', source_ecr__published_by=actor)
                | Q(publisher=actor, status__in=['approved', 'published'])
                | Q(status__in=['pending', 'approved', 'published'], review_rounds__number=F('current_review_round'),
                    review_rounds__records__reviewer=actor, review_rounds__records__assigned=True)
            ).distinct().select_related('source_ecr')
            readable = [row for row in candidates if can_read_body(actor, row)]
            source_ids = {row.source_ecr_id if row.stage == 'eco' else row.pk for row in readable}
            # Lock both instances in ID order before checking the permission and status summaries.
            pairs = list(ChangeRequest.objects.select_for_update().filter(
                Q(pk__in=source_ids) | Q(source_ecr_id__in=source_ids)
            ).order_by('pk'))
            sources = {row.pk: row for row in pairs if row.stage == 'ecr'}
            ecos = {row.source_ecr_id: row for row in pairs if row.stage == 'eco'}
            result = []
            for source_id, source in sources.items():
                eco = ecos.get(source_id)
                ecr_visible = can_read_body(actor, source)
                eco_visible = eco is not None and can_read_body(actor, eco)
                if not ecr_visible and not eco_visible:
                    continue
                ecr_summary = stage_summary(source, 'ecr', actor, source_brief=eco_visible)
                eco_summary = stage_summary(eco, 'eco', actor)
                if eco is None and not (source.applicant_id == actor.pk or is_ecr_coordinator(actor, source)):
                    eco_summary['status'] = 'unavailable'
                visible = [item for item in [ecr_summary, eco_summary] if item['can_open']]
                matching = [item for item in visible if workflow == 'all' or item['stage'] == workflow]
                if not matching or state != 'all' and not any(item['status'] == state for item in matching):
                    continue
                result.append({
                    'id': source_id, 'title': source.title,
                    'ecr': ecr_summary, 'eco': eco_summary,
                    'can_create_eco': is_ecr_coordinator(actor, source) and eco is None,
                    'can_delete_ecr': ecr_visible and source.applicant_id == actor.pk and source.status == 'draft',
                })
            result.sort(key=lambda item: (max(
                row.updated_at for row in [sources[item['id']], ecos.get(item['id'])]
                if row is not None and can_read_body(actor, row)
            ), item['id']), reverse=True)
            return Response({'actor_id': actor.pk, 'items': result})
