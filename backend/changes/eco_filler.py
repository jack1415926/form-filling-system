"""ECO移交只变更基础填写人，不改派任务，也不修改来源ECR的发布记录。"""
from django.contrib.auth import get_user_model
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import NotFound
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import ChangeRequest, EcoFillerEvent, EcoFillerInboxRead
from .review_access import can_read_body, is_eco_coordinator, readable_change
from .request_values import StrictValues, canonical, conflict


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
            # 交接后原填写人可能已无正文权限，仍可核对本人原请求的交接结果。
            previous = record.filler_events.filter(request_id=values['request_id']).first()
            if previous:
                if previous.actor_id != request.user.pk or previous.kind != 'transfer' or previous.payload != canonical(values):
                    conflict('相同交接标识的人员或内容不同，请核对原请求。')
                return Response({'receipt': receipt(previous), 'assignment': assignment_data(record, request.user) if can_read_body(request.user, record) else None})
            if not request.user.is_active or not (record.applicant_id == request.user.pk or is_eco_coordinator(request.user, record)):
                raise NotFound('没有ECO交接权限。')
            if record.status not in ['draft', 'returned']:
                conflict('ECO已提交或发布，不能更换填写人；退回修订后才可交接。')
            # 同时核对原填写人和最后保存版本，拒绝基于旧页面交接新内容。
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


class EcoFillerInbox(APIView):
    def get(self, request):
        with transaction.atomic():
            records = list(ChangeRequest.objects.select_for_update().filter(stage='eco', applicant=request.user).order_by('pk'))
            reads = set(EcoFillerInboxRead.objects.filter(user=request.user).values_list('event_id', flat=True))
            items = []
            for record in records:
                event = record.filler_events.select_related('actor').order_by('-pk').first()
                if not event or event.kind not in ['create', 'transfer'] or event.filler_id != request.user.pk or event.actor_id == request.user.pk or event.pk in reads:
                    continue
                items.append({'event_id': event.pk, 'change_id': record.pk, 'title': record.title,
                    'eco_no': record.eco_no, 'source_ecr_no': record.source_ecr.ecr_no,
                    'kind': event.kind, 'actor_name': event.actor.get_full_name() or event.actor.username,
                    'status': record.status})
            return Response({'actor_id': request.user.pk, 'unread_count': len(items), 'items': items})


class EcoFillerMarkRead(APIView):
    def post(self, request):
        if not isinstance(request.data, dict) or set(request.data) != {'event_id'} or type(request.data['event_id']) is not int or request.data['event_id'] < 1:
            raise serializers.ValidationError('填写提醒编号无效。')
        with transaction.atomic():
            event = get_object_or_404(EcoFillerEvent, pk=request.data['event_id'])
            record = get_object_or_404(ChangeRequest.objects.select_for_update(), pk=event.eco_id, stage='eco', applicant=request.user)
            latest = record.filler_events.order_by('-pk').first()
            if latest.pk != event.pk or event.filler_id != request.user.pk or event.kind not in ['create', 'transfer'] or event.actor_id == request.user.pk:
                conflict('填写人或消息已变化，请刷新提醒。')
            EcoFillerInboxRead.objects.get_or_create(user=request.user, event=event)
        return Response({'read': True})
