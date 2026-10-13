"""ECO ownership changes never change task ownership or published ECR evidence."""
from django.contrib.auth import get_user_model
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import NotFound
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import ChangeRequest, EcoFillerEvent
from .review_access import can_read_body, is_eco_coordinator, readable_change
from .review_issues import StrictValues, canonical, conflict


def person(user):
    return {'id': user.pk, 'display_name': user.get_full_name() or user.username, 'username': user.username, 'is_active': user.is_active}


def receipt(event):
    return {'request_id': str(event.request_id) if event.request_id else None, 'actor_id': event.actor_id,
            'change_id': event.eco_id, 'kind': event.kind, 'filler_id': event.filler_id,
            'previous_filler_id': event.previous_filler_id, 'created_at': event.created_at.isoformat()}


def assignment_data(record, actor):
    from .serializers import ChangeRequestSerializer
    events = record.filler_events.select_related('actor', 'previous_filler', 'filler').order_by('created_at', 'pk')
    return {'actor_id': actor.pk, 'change_id': record.pk, 'change': ChangeRequestSerializer(record).data,
            'filler': person(record.applicant), 'can_transfer': record.status in ['draft', 'returned'] and actor.is_active and (record.applicant_id == actor.pk or is_eco_coordinator(actor, record)),
            'history': [{**receipt(event), 'actor': person(event.actor) if event.actor else None,
                         'previous_filler': person(event.previous_filler) if event.previous_filler else None,
                         'filler': person(event.filler)} for event in events]}


class TransferValues(StrictValues):
    request_id = serializers.UUIDField()
    filler_id = serializers.IntegerField(min_value=1)
    expected_filler_id = serializers.IntegerField(min_value=1)
    expected_updated_at = serializers.DateTimeField()


class EcoFillerDetail(APIView):
    def get(self, request, pk):
        with transaction.atomic():
            record = readable_change(request, pk)
            if record.stage != 'eco': raise NotFound()
            return Response(assignment_data(record, request.user))

    def post(self, request, pk):
        serializer = TransferValues(data=request.data); serializer.is_valid(raise_exception=True)
        values = serializer.validated_data
        with transaction.atomic():
            record = get_object_or_404(ChangeRequest.objects.select_for_update(), pk=pk, stage='eco')
            previous = record.filler_events.filter(request_id=values['request_id']).first()
            if previous:
                if previous.actor_id != request.user.pk or previous.kind != 'transfer' or previous.payload != canonical(values):
                    conflict('相同交接标识的人员或内容不同，请核对原请求。')
                return Response({'receipt': receipt(previous), 'assignment': assignment_data(record, request.user) if can_read_body(request.user, record) else None})
            if not request.user.is_active or not (record.applicant_id == request.user.pk or is_eco_coordinator(request.user, record)):
                raise NotFound('没有ECO交接权限。')
            if record.status not in ['draft', 'returned']:
                conflict('ECO已提交或发布，不能更换填写人；退回修订后才可交接。')
            if record.applicant_id != values['expected_filler_id'] or record.updated_at != values['expected_updated_at']:
                conflict('ECO填写人或内容已变化，请刷新并确认最新已保存内容后交接。')
            filler = get_user_model().objects.select_for_update().filter(pk=values['filler_id'], is_active=True).first()
            if filler is None:
                raise serializers.ValidationError({'filler_id': '请选择有效填写人，不能选择停用账号。'})
            if filler.pk == record.applicant_id:
                raise serializers.ValidationError({'filler_id': '请选择另一位填写人；当前人员无需交接。'})
            event = EcoFillerEvent.objects.create(eco=record, kind='transfer', actor=request.user,
                previous_filler=record.applicant, filler=filler, request_id=values['request_id'], payload=canonical(values))
            record.applicant = filler; record.updated_at = timezone.now()
            record.save(update_fields=['applicant', 'updated_at'])
            return Response({'receipt': receipt(event), 'assignment': assignment_data(record, request.user) if can_read_body(request.user, record) else None})


class EcoFillerReceipt(APIView):
    def get(self, request, pk, request_id):
        event = get_object_or_404(EcoFillerEvent, eco_id=pk, request_id=request_id, actor=request.user)
        return Response(receipt(event))
