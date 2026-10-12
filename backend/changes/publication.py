"""Publish an immutable ECR and copy its base into one independent ECO."""
from django.contrib.auth import get_user_model
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.views import APIView

from .emc_views import matrix_data, persist
from .models import (ChangeRequest, MaterialChange, MaterialDisposition, QuestionResponse,
                     ExecutionPlanResponse, SignificantAssessment, SignificantChartResponse,
                     SignificantQuestionResponse)
from .review_access import readable_change, is_publication_reader
from .review_issues import StrictValues, conflict
from .serializers import ChangeRequestSerializer


def publication_data(record, actor):
    owner = record.applicant_id == actor.pk
    eco = ChangeRequest.objects.filter(source_ecr=record).first() if owner and record.stage == 'ecr' else None
    publisher = record.publisher
    return {'actor_id': actor.pk, 'change': ChangeRequestSerializer(record).data,
            'publisher_name': (publisher.get_full_name() or publisher.username) if publisher else '',
            'publisher_active': bool(publisher and publisher.is_active),
            'can_publish': is_publication_reader(actor, record) and record.status == 'approved',
            'can_create_eco': record.stage == 'ecr' and owner and record.status == 'published' and eco is None,
            'eco_id': eco.pk if eco else None}


class PublicationList(APIView):
    default_stage = 'ecr'
    def get(self, request):
        state = request.query_params.get('state', 'approved')
        if state not in ['approved', 'published']:
            raise serializers.ValidationError({'state': '仅支持待发布或已发布。'})
        stage = request.query_params.get('stage', 'all') if self.default_stage == 'all' else 'ecr'
        if stage not in ['all', 'ecr', 'eco']:
            raise serializers.ValidationError({'stage': '阶段不合法。'})
        rows = ChangeRequest.objects.filter(stage__in=['ecr', 'eco'] if stage == 'all' else [stage], status=state, publisher=request.user)
        return Response(ChangeRequestSerializer(rows, many=True).data)


class AllPublicationList(PublicationList):
    default_stage = 'all'


class PublishValues(StrictValues):
    request_id = serializers.UUIDField()
    expected_round = serializers.IntegerField(min_value=1)


class PublicationDetail(APIView):
    def get(self, request, pk):
        with transaction.atomic():
            record = readable_change(request, pk)
            if record.stage not in ['ecr', 'eco']:
                conflict('仅新ECR／ECO具有发布流程。')
            return Response(publication_data(record, request.user))

    def post(self, request, pk):
        values = PublishValues(data=request.data); values.is_valid(raise_exception=True)
        payload = values.validated_data
        with transaction.atomic():
            record = readable_change(request, pk)
            if record.stage not in ['ecr', 'eco']:
                conflict('仅新ECR／ECO可以发布。')
            if record.publisher_id != request.user.pk:
                conflict('只有当前指定发布人可以发布。')
            if record.publication_request_id == payload['request_id']:
                if record.published_by_id != request.user.pk or record.current_review_round != payload['expected_round']:
                    conflict('同一发布请求携带了不同轮次或账号。')
                return Response(publication_data(record, request.user))
            if record.status != 'approved' or record.current_review_round != payload['expected_round']:
                conflict('阶段状态或批准轮次已变化，请刷新核对。')
            account = get_user_model().objects.select_for_update().get(pk=request.user.pk)
            if not account.is_active:
                conflict('发布人账号已停用，请恢复账号后发布。')
            round = record.review_rounds.filter(number=record.current_review_round, state='approved').first()
            if round is None or round.tasks.filter(confirmed_at__isnull=True).exists() or record.review_issues.exclude(state='resolved').exists():
                conflict('当前轮次、任务确认或审核意见尚未满足发布条件。')
            # Unsaved EMC is currently read from a shared template; freeze it at publication.
            if not hasattr(record, 'emc_reference'):
                persist(record, matrix_data(record))
            record.status = 'published'; record.published_by = account
            record.published_at = record.updated_at = timezone.now()
            record.publication_request_id = payload['request_id']
            record.save(update_fields=['status', 'published_by', 'published_at', 'publication_request_id', 'updated_at'])
            return Response(publication_data(record, request.user))


BASE_FIELDS = ('title', 'affected_products', 'affected_region', 'initiating_factory',
               'affected_factories', 'ccb_owner', 'change_owner', 'planned_eco_date', 'change_reason')


def copy_values(row, excluded):
    return {field.attname: getattr(row, field.attname) for field in row._meta.concrete_fields
            if not field.primary_key and field.attname not in excluded}


def copy_base(source, eco):
    for material in source.materials.prefetch_related('dispositions').order_by('id'):
        copied = MaterialChange.objects.create(change=eco, **copy_values(material, {'change_id', 'request_id'}))
        MaterialDisposition.objects.bulk_create([
            MaterialDisposition(material=copied, **copy_values(row, {'material_id'})) for row in material.dispositions.all()])
    for model, relation in [(QuestionResponse, 'question_responses'), (ExecutionPlanResponse, 'execution_plan_responses'),
                            (SignificantChartResponse, 'significant_charts'), (SignificantQuestionResponse, 'significant_questions')]:
        model.objects.bulk_create([model(change=eco, **copy_values(row, {'change_id'})) for row in getattr(source, relation).all()])
    if hasattr(source, 'significant_assessment'):
        SignificantAssessment.objects.create(change=eco, **copy_values(source.significant_assessment, {'change_id'}))
    # Rebuild row/test IDs from stable keys; no foreign key points to source EMC.
    persist(eco, matrix_data(source))


class CreateEcoValues(StrictValues):
    request_id = serializers.UUIDField()


class CreateEco(APIView):
    def post(self, request, pk):
        values = CreateEcoValues(data=request.data); values.is_valid(raise_exception=True)
        with transaction.atomic():
            source = get_object_or_404(ChangeRequest.objects.select_for_update(), pk=pk, applicant=request.user)
            if source.stage != 'ecr' or source.status != 'published':
                conflict('只有已发布的新ECR可以创建ECO。')
            existing = ChangeRequest.objects.filter(source_ecr=source).first()
            if existing:
                return Response({'created': False, 'change': ChangeRequestSerializer(existing).data})
            eco = ChangeRequest.objects.create(applicant=request.user, stage='eco', source_ecr=source,
                eco_creation_request_id=values.validated_data['request_id'],
                **{field: getattr(source, field) for field in BASE_FIELDS})
            copy_base(source, eco)
            return Response({'created': True, 'change': ChangeRequestSerializer(eco).data}, status=201)
