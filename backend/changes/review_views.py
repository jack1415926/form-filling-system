from django.db import transaction
from django.db.models import Q, F, Exists, OuterRef
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import NotFound
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import ChangeRequest, ReviewRound, ReviewRecord, ReviewFeedback
from .permissions import ExpectedAccountPermission
from .review_access import is_owner, eligible, can_read_round, reviewer_rounds
from .roles import business_role
from .serializers import ChangeRequestSerializer
from .review_issues import (ReturnValues, IssueActionValues, ApproveValues, blockers, issue_data,
                            replay, event, checked_issue, return_issues)


def person(user):
    return {'id': user.pk, 'username': user.username, 'display_name': user.get_full_name() or user.username}


def round_data(round):
    records = list(round.records.select_related('reviewer').order_by('reviewer_id'))
    return {'number': round.number, 'title': round.title, 'ecr_no': round.ecr_no, 'eco_no': round.eco_no,
            'review_mode': round.review_mode, 'submitted_at': round.submitted_at.isoformat(), 'state': round.state,
            'approved_at': round.approved_at.isoformat() if round.approved_at else None,
            'returned_at': round.returned_at.isoformat() if round.returned_at else None,
            'returned_by': person(round.returned_by) if round.returned_by_id else None, 'return_reason': round.return_reason,
            'reviewers': [person(row.reviewer) for row in records if row.assigned],
            'approvals': [{**person(row.reviewer), 'approved_at': row.approved_at.isoformat()} for row in records if row.approved_at]}


def review_data(record, round, user):
    current = record.current_review_round == round.number
    owner = is_owner(user, record)
    allowed = eligible(user, round)
    may_review = current and record.status == 'pending' and round.state == 'pending' and allowed
    may_view = current and (owner or record.status in ['pending', 'approved'] and allowed)
    rounds = [row for row in record.review_rounds.order_by('number') if can_read_round(user, row)]
    notes = ReviewFeedback.objects.filter(round__in=rounds).select_related('author', 'round').order_by('created_at', 'id')
    return {'change_id': record.pk, 'updated_at': record.updated_at.isoformat(), 'current_round': record.current_review_round,
            'round': round_data(round), 'is_current': current, 'can_view_form': may_view,
            'can_approve': may_review and not record.review_issues.exclude(state='resolved').exists() and not round.records.filter(reviewer=user, approved_at__isnull=False).exists(),
            'can_return': may_review, 'can_feedback': False,
            'issues': issue_data(record, round, user, owner, allowed, current),
            'unresolved_count': record.review_issues.exclude(state='resolved').count() if current else 0,
            'issue_blockers': blockers(record) if current else [],
            'confirmed_requests': [str(value) for value in record.issue_events.filter(author=user, round=round).values_list('request_id', flat=True).distinct()],
            'form': ChangeRequestSerializer(record).data if may_view else None,
            'history': [round_data(row) for row in rounds],
            'feedback': [{'id': note.pk, 'round_number': note.round.number, 'author': person(note.author),
                          'text': note.text, 'request_id': str(note.request_id), 'created_at': note.created_at.isoformat()} for note in notes]}


class ReviewList(APIView):
    permission_classes = [IsAuthenticated, ExpectedAccountPermission]
    http_method_names = ['get', 'head', 'options']

    def get(self, request):
        if business_role(request.user) != 'reviewer':
            return Response({'detail': '此入口仅对审核员开放。', 'code': 'role_forbidden'}, status=403)
        kind = request.query_params.get('kind', 'designated')
        if kind not in ['designated', 'public', 'handled', 'returned']:
            raise serializers.ValidationError({'kind': '列表类型不合法。'})
        own_approved = ReviewRecord.objects.filter(round_id=OuterRef('pk'), reviewer=request.user, approved_at__isnull=False)
        rows = ReviewRound.objects.exclude(change__applicant=request.user).annotate(my_approved=Exists(own_approved))
        if kind == 'handled':
            rows = rows.filter(Q(my_approved=True) | Q(returned_by=request.user))
        elif kind == 'returned':
            rows = rows.filter(number=F('change__current_review_round'), state='returned', change__status='returned').filter(reviewer_rounds(request.user))
        else:
            rows = rows.filter(number=F('change__current_review_round'), state='pending', change__status='pending', my_approved=False,
                               review_mode=kind).filter(reviewer_rounds(request.user))
        return Response([{'change_id': row.change_id, **round_data(row)} for row in rows.select_related('change', 'returned_by').distinct().order_by('-submitted_at', '-pk')])


class TextValues(serializers.Serializer):
    text = serializers.CharField(max_length=10000, allow_blank=False)
    request_id = serializers.UUIDField(required=False)

    def to_internal_value(self, data):
        if not isinstance(data, dict):
            raise serializers.ValidationError({'detail': '请求内容必须是对象。'})
        allowed = {'text', 'request_id'} if self.context.get('feedback') else {'text'}
        forbidden = set(data) - allowed
        if forbidden:
            raise serializers.ValidationError({key: '此字段不允许修改。' for key in forbidden})
        if not isinstance(data.get('text'), str):
            raise serializers.ValidationError({'text': '必须是非空文字。'})
        if self.context.get('feedback') and not data.get('request_id'):
            raise serializers.ValidationError({'request_id': '反馈必须携带重试标识。'})
        return super().to_internal_value(data)


class ReviewDetail(APIView):
    permission_classes = [IsAuthenticated, ExpectedAccountPermission]
    http_method_names = ['get', 'post', 'head', 'options']

    def locked(self, request, pk, number):
        record = get_object_or_404(ChangeRequest.objects.select_for_update(), pk=pk)
        round = get_object_or_404(record.review_rounds, number=number)
        if not can_read_round(request.user, round):
            raise NotFound('审核记录不存在或没有权限。')
        return record, round

    def get(self, request, pk, number, action=None):
        if action is not None:
            return Response({'detail': '审核动作只接受POST。'}, status=405)
        with transaction.atomic():
            record, round = self.locked(request, pk, number)
            return Response(review_data(record, round, request.user))

    def post(self, request, pk, number, action=None):
        if action not in ['approve', 'return', 'feedback', 'respond', 'resolve']:
            raise NotFound()
        if action == 'feedback':
            return Response({'detail': '普通留言已停止新增，历史留言只读保留。'}, status=409)
        serializer = (ApproveValues if action == 'approve' else ReturnValues if action == 'return' else IssueActionValues)(data=request.data)
        serializer.is_valid(raise_exception=True)
        values = serializer.validated_data
        with transaction.atomic():
            record, round = self.locked(request, pk, number)
            if record.current_review_round != number:
                return Response({'detail': '该页面属于旧审核轮次，请刷新当前状态。'}, status=409)
            owner, reviewer = is_owner(request.user, record), eligible(request.user, round)
            if action == 'respond' and not owner:
                return Response({'detail': '只有申请本人可以回应意见。'}, status=403)
            if action != 'respond' and not reviewer:
                return Response({'detail': '没有本轮审核权限。'}, status=403)
            if replay(record, request.user, action, values):
                return Response(review_data(record, round, request.user))
            if action == 'approve':
                existing = round.records.filter(reviewer=request.user).first()
                if existing and existing.approved_at and record.status in ['pending', 'approved']:
                    event(record, round, request.user, action, values)
                    record.updated_at = timezone.now(); record.save(update_fields=['updated_at'])
                    return Response(review_data(record, round, request.user))
                if record.status != 'pending' or round.state != 'pending':
                    return Response({'detail': '本轮已结束，不能再通过。'}, status=409)
                if record.review_issues.exclude(state='resolved').exists():
                    return Response({'detail': '存在未解决正式意见，不能批准。'}, status=409)
                row = existing or ReviewRecord(change=record, round=round, reviewer=request.user, assigned=False)
                row.approved_at = timezone.now(); row.save()
                approvals = round.records.filter(approved_at__isnull=False).count()
                done = approvals >= 2 if round.review_mode == 'public' else not round.records.filter(assigned=True, approved_at__isnull=True).exists()
                if done:
                    round.state = 'approved'; round.approved_at = row.approved_at; round.save(update_fields=['state', 'approved_at'])
                    record.status = 'approved'
                event(record, round, request.user, action, values)
            elif action == 'return':
                if record.status != 'pending' or round.state != 'pending':
                    return Response({'detail': '本轮已结束，不能再退回。'}, status=409)
                reason = return_issues(record, round, request.user, values)
                round.state = 'returned'; round.returned_by = request.user; round.return_reason = reason; round.returned_at = timezone.now()
                round.save(update_fields=['state', 'returned_by', 'return_reason', 'returned_at']); record.status = 'returned'
            else:
                if action == 'respond' and record.status != 'returned' or action == 'resolve' and record.status != 'pending':
                    return Response({'detail': '当前状态不允许此意见操作。'}, status=409)
                issue = checked_issue(record, request.user, values, owner=action == 'respond')
                if action == 'resolve' and issue.state != 'awaiting_review':
                    return Response({'detail': '填写员尚未回应，不能确认解决。'}, status=409)
                issue.state = 'awaiting_review' if action == 'respond' else 'resolved'; issue.version += 1
                issue.save(update_fields=['state', 'version'])
                event(record, round, request.user, action, values, issue, values['text'])
            record.updated_at = timezone.now(); record.save(update_fields=['status', 'updated_at'])
            return Response(review_data(record, round, request.user))
