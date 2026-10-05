from django.contrib.auth import get_user_model
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import ChangeRequest, ReviewRecord, ReviewRound
from .roles import REVIEWER_GROUP, business_role
from .serializers import ChangeRequestSerializer
from .review_issues import blockers


def reviewer_data(user):
    return {'id': user.pk, 'username': user.username, 'display_name': user.get_full_name() or user.username}


def active_reviewers():
    return get_user_model().objects.filter(is_active=True, groups__name=REVIEWER_GROUP).distinct().order_by('pk')


class ReviewerList(APIView):
    http_method_names = ['get', 'head', 'options']

    def get(self, request):
        return Response([reviewer_data(user) for user in active_reviewers()])


class SubmissionValues(serializers.Serializer):
    review_mode = serializers.ChoiceField(choices=['designated', 'public'])
    reviewer_ids = serializers.ListField(child=serializers.IntegerField(min_value=1), allow_empty=True)
    expected_round = serializers.IntegerField(min_value=0, required=False)
    request_id = serializers.UUIDField(required=False)

    def to_internal_value(self, data):
        if not isinstance(data, dict):
            raise serializers.ValidationError({'detail': '请求内容必须是对象。'})
        forbidden = set(data) - set(self.fields)
        if forbidden:
            raise serializers.ValidationError({key: '此字段不允许修改。' for key in forbidden})
        if 'expected_round' in data and type(data['expected_round']) is not int:
            raise serializers.ValidationError({'expected_round': '轮次必须为整数。'})
        ids = data.get('reviewer_ids')
        if not isinstance(ids, list) or any(type(value) is not int for value in ids):
            raise serializers.ValidationError({'reviewer_ids': '审核员ID必须为整数列表。'})
        return super().to_internal_value(data)

    def validate(self, values):
        ids = values['reviewer_ids']
        if len(set(ids)) != len(ids):
            raise serializers.ValidationError({'reviewer_ids': '审核员不能重复。'})
        if values['review_mode'] == 'designated' and not ids:
            raise serializers.ValidationError({'reviewer_ids': '指定审核至少选择一名审核员。'})
        if values['review_mode'] == 'public' and ids:
            raise serializers.ValidationError({'reviewer_ids': '公开审核不指定人员。'})
        return values


class SubmissionDetail(APIView):
    http_method_names = ['get', 'post', 'head', 'options']

    @staticmethod
    def data(record):
        round = record.review_rounds.filter(number=record.current_review_round).first()
        reviewers = round.records.filter(assigned=True).select_related('reviewer').order_by('reviewer_id') if round and round.review_mode == 'designated' else []
        return {'change': ChangeRequestSerializer(record).data, 'reviewers': [reviewer_data(row.reviewer) for row in reviewers], 'request_id': str(round.request_id) if round and round.request_id else None,
                'review_arrangement_locked': record.review_issues.exclude(state='resolved').exists(), 'issue_blockers': blockers(record)}

    def get(self, request, pk):
        with transaction.atomic():
            record = get_object_or_404(ChangeRequest.objects.select_for_update(), pk=pk, applicant=request.user)
            return Response(self.data(record))

    def post(self, request, pk):
        serializer = SubmissionValues(data=request.data)
        serializer.is_valid(raise_exception=True)
        values = serializer.validated_data
        with transaction.atomic():
            record = get_object_or_404(ChangeRequest.objects.select_for_update(), pk=pk, applicant=request.user)
            # Recheck after any wait for the application lock.
            if business_role(request.user) != 'filler':
                return Response({'detail': '账号角色已变化，请刷新身份。', 'code': 'role_forbidden'}, status=403)
            current = record.review_rounds.filter(number=record.current_review_round).first()
            request_id = values.get('request_id')
            if request_id:
                repeated = record.review_rounds.filter(request_id=request_id).first()
                if repeated:
                    saved_ids = list(repeated.records.filter(assigned=True).order_by('reviewer_id').values_list('reviewer_id', flat=True))
                    if repeated.number == record.current_review_round and repeated.review_mode == values['review_mode'] and saved_ids == sorted(values['reviewer_ids']):
                        return Response(self.data(record))
                    return Response({'detail': '该提交请求已属于其他轮次或内容不同，请读取当前状态。'}, status=409)
            if record.status not in ['draft', 'returned']:
                saved_ids = list(current.records.filter(assigned=True).order_by('reviewer_id').values_list('reviewer_id', flat=True)) if current else []
                if not request_id and current and current.number == 1 and current.review_mode == values['review_mode'] and saved_ids == sorted(values['reviewer_ids']):
                    return Response(self.data(record))
                return Response({'detail': '申请已锁定，不能重复开启审核轮次。'}, status=409)
            if values.get('expected_round', 0) != record.current_review_round:
                return Response({'detail': '申请轮次已变化，请刷新后再次提交。'}, status=409)
            if record.status == 'returned' and not request_id:
                raise serializers.ValidationError({'request_id': '再次提交必须携带新的请求标识。'})
            if record.review_issues.exclude(state='resolved').exists():
                reasons = blockers(record)
                if reasons:
                    return Response({'detail': ' '.join(reasons)}, status=409)
                saved_ids = list(current.records.filter(assigned=True).order_by('reviewer_id').values_list('reviewer_id', flat=True))
                if current.review_mode != values['review_mode'] or saved_ids != sorted(values['reviewer_ids']):
                    return Response({'detail': '存在未解决意见，重提必须沿用原审核方式及指定名单。'}, status=409)
            errors = {field: '提交前必须填写。' for field in ['title', 'ecr_no'] if not getattr(record, field).strip()}
            if errors:
                raise serializers.ValidationError(errors)
            # Lock account rows while checking activity and membership for this submission.
            candidates = list(active_reviewers().exclude(pk=record.applicant_id).select_for_update())
            available = {user.pk for user in candidates}
            if values['review_mode'] == 'public' and len(available) < 2:
                raise serializers.ValidationError({'review_mode': '系统中的有效审核员不足两人，请联系账号维护人员设置审核员身份。'})
            if not set(values['reviewer_ids']).issubset(available):
                raise serializers.ValidationError({'reviewer_ids': '所选账号不存在、已停用或不是审核员，请重新选择。'})
            if record.review_records.filter(round__isnull=True).exists():
                return Response({'detail': '草稿已有异常审核关联，请先核对数据。'}, status=409)
            now = timezone.now()
            round = ReviewRound.objects.create(change=record, number=record.current_review_round + 1,
                review_mode=values['review_mode'], request_id=request_id, title=record.title, ecr_no=record.ecr_no,
                eco_no=record.eco_no, submitted_at=now)
            ReviewRecord.objects.bulk_create([ReviewRecord(change=record, round=round, reviewer_id=pk) for pk in values['reviewer_ids']])
            record.current_review_round = round.number
            record.review_mode = values['review_mode']
            record.submitted_at = record.updated_at = now
            record.status = ChangeRequest.Status.PENDING
            record.save(update_fields=['current_review_round', 'review_mode', 'submitted_at', 'updated_at', 'status'])
            return Response(self.data(record))
