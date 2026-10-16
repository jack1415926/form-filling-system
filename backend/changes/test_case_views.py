"""Developer-only creation of new synthetic cases; never changes an existing application."""
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import CommandError
from django.db import transaction
from rest_framework import serializers
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from .management.commands.seed_workflow import Command, STATES
from .models import ChangeRequest
from .request_values import StrictValues


class TestCaseValues(StrictValues):
    request_id = serializers.UUIDField()
    stage = serializers.ChoiceField(choices=['ecr', 'eco'])
    state = serializers.ChoiceField(choices=list(STATES))
    reviewer_ids = serializers.ListField(child=serializers.IntegerField(min_value=1), allow_empty=False)
    approver_ids = serializers.ListField(child=serializers.IntegerField(min_value=1), allow_empty=False)
    publisher_id = serializers.IntegerField(min_value=1)


class TestCaseCreate(APIView):
    def post(self, request):
        if not settings.DEBUG:
            raise NotFound()
        values = TestCaseValues(data=request.data)
        values.is_valid(raise_exception=True)
        data = values.validated_data
        token = data['request_id'].hex
        with transaction.atomic():
            # Serialize requests from this applicant so a retried POST cannot create two cases.
            actor = get_user_model().objects.select_for_update().get(pk=request.user.pk)
            if not actor.is_active:
                raise NotFound()
            users = {'applicant': actor}
            for role in ['reviewer', 'approver']:
                ids = set(data[role + '_ids'])
                people = list(get_user_model().objects.filter(pk__in=ids, is_active=True).order_by('pk'))
                if len(people) != len(ids):
                    raise ValidationError({role + '_ids': '请选择有效账号。'})
                users[role + 's'] = people
            try:
                users['publisher'] = get_user_model().objects.get(pk=data['publisher_id'], is_active=True)
            except get_user_model().DoesNotExist:
                raise ValidationError({'publisher_id': '请选择有效账号。'}) from None
            source = ChangeRequest.objects.filter(ecr_no=f'TEST-ECR-{token}').first()
            if source:
                record = ChangeRequest.objects.filter(source_ecr=source).first() if data['stage'] == 'eco' else source
                actions = (record.eco_responses if record.stage == 'eco' else record.ecr_responses) if record else None
                assignments = [set(row.owners.values_list('pk', flat=True)) for row in actions.all()] if actions is not None else []
                if (source.applicant_id != actor.pk or record is None
                        or record.title != f"[测试] {data['stage'].upper()} {STATES[data['state']]} {token}"
                        or record.publisher_id != users['publisher'].pk
                        or set(record.stage_approvers.values_list('pk', flat=True)) != {user.pk for user in users['approvers']}
                        or not assignments or any(ids != {user.pk for user in users['reviewers']} for ids in assignments)):
                    return Response({'detail': '该生成请求已使用且内容不同，请核对原用例。'}, status=409)
                status = 200
            else:
                try:
                    record = Command().create_scenario(data['stage'], data['state'], users, token)
                except CommandError as error:
                    raise ValidationError({'detail': str(error)}) from error
                status = 201
            return Response({'actor_id': actor.pk, 'id': record.pk, 'stage': record.stage,
                             'state': data['state'], 'title': record.title,
                             'number': record.eco_no or record.ecr_no, 'source_ecr_id': record.source_ecr_id}, status=status)
