from django.db import transaction
from django.db.models import OuterRef, Subquery, Q
from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.exceptions import APIException
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import SystemFeedback, SystemFeedbackEvent, SystemFeedbackRead
from .permissions import ExpectedAccountPermission
from .roles import can_manage_feedback

CATEGORIES = ['problem', 'suggestion', 'other']
STATES = ['pending', 'processing', 'closed']


class StrictInput(serializers.Serializer):
    def to_internal_value(self, data):
        if not isinstance(data, dict) or set(data) - set(self.fields):
            raise serializers.ValidationError({'detail': '请求包含未知字段或格式错误。'})
        for name in ['content', 'text']:
            if name in data and not isinstance(data[name], str):
                raise serializers.ValidationError({name: '请输入文字。'})
        if 'expected_version' in data and (type(data['expected_version']) is not int):
            raise serializers.ValidationError({'expected_version': '版本必须为整数。'})
        return super().to_internal_value(data)


class CreateInput(StrictInput):
    category = serializers.ChoiceField(choices=CATEGORIES)
    content = serializers.CharField(max_length=5000, trim_whitespace=True)
    request_id = serializers.UUIDField()


class ActionInput(StrictInput):
    text = serializers.CharField(max_length=5000, allow_blank=True, trim_whitespace=True)
    status = serializers.ChoiceField(choices=STATES)
    expected_version = serializers.IntegerField(min_value=0)
    request_id = serializers.UUIDField()


class FollowupInput(StrictInput):
    text = serializers.CharField(max_length=5000, trim_whitespace=True)
    expected_version = serializers.IntegerField(min_value=0)
    request_id = serializers.UUIDField()


class ManagerPermission(BasePermission):
    def has_permission(self, request, view):
        if not can_manage_feedback(request.user):
            error = APIException({'detail': '反馈管理权限已取消或未配置，请刷新身份。', 'code': 'feedback_permission_changed'})
            error.status_code = 403
            raise error
        return True


def conflict(message):
    error = APIException({'detail': message})
    error.status_code = 409
    raise error


def person(user):
    return {'id': user.pk, 'display_name': user.get_full_name() or user.username}


def event_data(event):
    return {'id': event.pk, 'actor': person(event.actor), 'text': event.text, 'kind': event.kind,
            'from_status': event.from_status, 'to_status': event.to_status,
            'request_id': str(event.request_id), 'base_version': event.base_version,
            'created_at': event.created_at.isoformat()}


def feedback_data(row, detail=False):
    result = {'id': row.pk, 'submitter': person(row.submitter), 'category': row.category,
              'content': row.content, 'status': row.status, 'request_id': str(row.request_id),
              'version': row.version, 'created_at': row.created_at.isoformat(), 'updated_at': row.updated_at.isoformat()}
    if detail:
        result['events'] = [event_data(event) for event in row.events.select_related('actor').order_by('id')]
    return result


class FeedbackBase(APIView):
    permission_classes = [IsAuthenticated, ExpectedAccountPermission]
    managed = False

    def rows(self, request):
        rows = SystemFeedback.objects.select_related('submitter')
        return rows if self.managed else rows.filter(submitter=request.user)


class FeedbackList(FeedbackBase):
    def get(self, request):
        rows = self.rows(request)
        for field, choices in [('category', CATEGORIES), ('status', STATES)]:
            value = request.query_params.get(field, '')
            if value:
                if value not in choices:
                    raise serializers.ValidationError({field: '筛选值无效。'})
                rows = rows.filter(**{field: value})
        rows = rows.order_by('created_at', 'id') if self.managed else rows.order_by('-created_at', '-id')
        pagination = PageNumberPagination()
        pagination.page_size = 20
        return pagination.get_paginated_response([feedback_data(row) for row in pagination.paginate_queryset(rows, request)])

    def post(self, request):
        values = CreateInput(data=request.data)
        values.is_valid(raise_exception=True)
        values = values.validated_data
        # The unique key serializes concurrent retries without locking any application row.
        with transaction.atomic():
            row, created = SystemFeedback.objects.get_or_create(submitter=request.user, request_id=values['request_id'],
                defaults={'category': values['category'], 'content': values['content']})
            row = self.rows(request).select_for_update(of=('self',)).get(pk=row.pk)
            if row.category != values['category'] or row.content != values['content']:
                conflict('同一请求的反馈内容不同，请查询原反馈。')
            return Response(feedback_data(row, True), status=201 if created else 200)


class FeedbackDetail(FeedbackBase):
    def get(self, request, pk):
        with transaction.atomic():
            row = get_object_or_404(self.rows(request).select_for_update(of=('self',)), pk=pk)
            return Response(feedback_data(row, True))


class FeedbackRequest(FeedbackBase):
    def get(self, request, request_id):
        with transaction.atomic():
            row = get_object_or_404(self.rows(request).select_for_update(of=('self',)), request_id=request_id)
            return Response(feedback_data(row, True))


class ManagedList(FeedbackList):
    managed = True
    permission_classes = [IsAuthenticated, ExpectedAccountPermission, ManagerPermission]
    http_method_names = ['get', 'head', 'options']


class ManagedDetail(FeedbackDetail):
    managed = True
    permission_classes = [IsAuthenticated, ExpectedAccountPermission, ManagerPermission]


class ManagedAction(ManagedDetail):
    http_method_names = ['post', 'options']
    event_kind = 'manager'
    input_class = ActionInput

    def post(self, request, pk):
        values = self.input_class(data=request.data)
        values.is_valid(raise_exception=True)
        values = values.validated_data
        with transaction.atomic():
            row = get_object_or_404(self.rows(request).select_for_update(of=('self',)), pk=pk)
            existing = row.events.filter(request_id=values['request_id']).first()
            if existing:
                if (existing.actor_id != request.user.pk or existing.kind != self.event_kind or existing.text != values['text']
                    or (self.event_kind == 'manager' and existing.to_status != values['status']) or existing.base_version != values['expected_version']):
                    conflict('同一请求的操作者或内容不同，请查询原处理记录。')
                return Response(feedback_data(row, True))
            if row.version != values['expected_version']:
                conflict('反馈已被更新，请刷新记录并核对后再处理；输入仍可保留。')
            target = values['status'] if self.event_kind == 'manager' else ('processing' if row.status == 'closed' else row.status)
            text = values['text']
            if self.event_kind == 'manager' and row.status == 'closed' and target == 'pending':
                raise serializers.ValidationError('重新打开只能转为处理中。')
            if row.status == 'processing' and target == 'pending':
                raise serializers.ValidationError('处理中不能退回待处理。')
            if not text and (target == row.status or target == 'closed' or row.status == 'closed'):
                raise serializers.ValidationError({'text': '回复、关闭或重新打开时必须填写说明。'})
            SystemFeedbackEvent.objects.create(feedback=row, actor=request.user, text=text,
                kind=self.event_kind, from_status=row.status, to_status=target, request_id=values['request_id'], base_version=row.version)
            row.status = target
            row.version += 1
            row.save(update_fields=['status', 'version', 'updated_at'])
            return Response(feedback_data(row, True))


class ManagedRequest(ManagedDetail):
    def get(self, request, pk, request_id):
        with transaction.atomic():
            row = get_object_or_404(self.rows(request).select_for_update(of=('self',)), pk=pk)
            get_object_or_404(row.events, request_id=request_id, actor=request.user)
            return Response(feedback_data(row, True))


class FeedbackFollowup(ManagedAction):
    managed = False
    permission_classes = [IsAuthenticated, ExpectedAccountPermission]
    event_kind = 'followup'
    input_class = FollowupInput


class FollowupRequest(ManagedRequest):
    managed = False
    permission_classes = [IsAuthenticated, ExpectedAccountPermission]


def inbox_rows(user):
    manager = can_manage_feedback(user)
    rows = SystemFeedback.objects.all() if manager else SystemFeedback.objects.filter(submitter=user)
    incoming = SystemFeedbackEvent.objects.filter(feedback_id=OuterRef('pk')).exclude(actor=user).filter(
        Q(kind='manager', feedback__submitter=user) | Q(kind='followup') & ~Q(feedback__submitter=user)
    ).order_by('-base_version')
    read = SystemFeedbackRead.objects.filter(user=user, feedback_id=OuterRef('pk'))
    return rows.annotate(incoming_version=Subquery(incoming.values('base_version')[:1]), read_version=Subquery(read.values('version')[:1])).order_by('-updated_at', '-id')


def incoming_version(row, user):
    if row.incoming_version is not None:
        return row.incoming_version + 1
    return 0 if row.submitter_id != user.pk else None


def inbox_data(user):
    items = []
    for row in inbox_rows(user):
        version = incoming_version(row, user)
        if version is not None and row.read_version != version:
            items.append({'id': row.pk, 'message_version': version, 'content': row.content[:80], 'status': row.status,
                          'managed': row.submitter_id != user.pk, 'read_version': row.read_version})
    return {'unread_count': len(items), 'items': items}


class FeedbackInbox(FeedbackBase):
    def get(self, request):
        return Response(inbox_data(request.user))


class FeedbackMarkRead(FeedbackBase):
    def post(self, request):
        if not isinstance(request.data, dict) or set(request.data) != {'id', 'message_version'}:
            raise serializers.ValidationError('已读请求格式错误。')
        pk, version = request.data['id'], request.data['message_version']
        if type(pk) is not int or pk < 1 or type(version) is not int or version < 0:
            raise serializers.ValidationError('反馈编号或消息版本无效。')
        with transaction.atomic():
            allowed = SystemFeedback.objects.all() if can_manage_feedback(request.user) else SystemFeedback.objects.filter(submitter=request.user)
            get_object_or_404(allowed.select_for_update(), pk=pk)
            row = inbox_rows(request.user).get(pk=pk)
            if incoming_version(row, request.user) != version:
                conflict('反馈消息已更新，请刷新后查看新消息。')
            SystemFeedbackRead.objects.update_or_create(user=request.user, feedback=row, defaults={'version': version})
        return Response(inbox_data(request.user))
