import hashlib
import json

from django.db import transaction
from django.db.models import Count, F, Max, Q
from rest_framework import serializers
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import ChangeRequest, ReviewInboxRead, ReviewRound
from .permissions import ExpectedAccountPermission
from .request_values import StrictValues


class ReviewInbox(APIView):
    permission_classes = [IsAuthenticated, ExpectedAccountPermission]
    http_method_names = ['get', 'head', 'options']

    def get(self, request):
        items = self.applicant_items(request)
        items += self.stage_items(request)
        items += self.publication_items(request)
        return Response({'actor_id': request.user.pk,
                         'count': sum(item['count'] for item in items),
                         'unread_count': sum(item['count'] for item in items if not item['is_read']), 'items': items})

    def applicant_items(self, request):
        rows = ReviewRound.objects.filter(number=F('change__current_review_round'),
                                         state=F('change__status'), state__in=['pending', 'returned'])
        rows = rows.filter(change__stage__in=['ecr', 'eco'], change__applicant=request.user, state='returned').annotate(
                unanswered=Count('change__review_issues', filter=Q(change__review_issues__state='awaiting_reply'), distinct=True),
                latest_incoming=Max('change__issue_events__id', filter=Q(change__issue_events__kind='return')))
        rows = list(rows.select_related('change').distinct().order_by('-change__updated_at', '-pk'))
        reads = dict(ReviewInboxRead.objects.filter(user=request.user, round_id__in=[row.pk for row in rows])
                     .values_list('round_id', 'signature'))
        items = []
        for row in rows:
            count = max(1, row.unanswered)
            notes = [f'{row.unanswered}条审核意见待回应' if row.unanswered else '申请已退回，待修订或重新提交']
            open_issues = bool(row.unanswered)
            if count:
                # Only incoming messages/new rounds notify again; own replies/resolutions do not.
                signature = hashlib.sha256(json.dumps(['filler', row.pk, row.latest_incoming or 0]).encode()).hexdigest()
                items.append({'change_id': row.change_id, 'round': row.number, 'title': row.change.title,
                              'context': 'applicant',
                              'stage': row.change.stage, 'eco_no': row.eco_no,
                              'ecr_no': row.change.source_ecr.ecr_no if row.change.stage == 'eco' else row.change.ecr_no, 'status': row.state, 'count': count,
                              'summary': '；'.join(notes), 'open_issues': open_issues,
                              'message_key': signature, 'is_read': reads.get(row.pk) == signature})
        return items

    def stage_items(self, request):
        rows = ReviewRound.objects.filter(change__stage__in=['ecr', 'eco'], number=F('change__current_review_round'),
            state=F('change__status'), state__in=['pending', 'returned'], records__reviewer=request.user, records__assigned=True).select_related('change').distinct()
        reads = dict(ReviewInboxRead.objects.filter(user=request.user, round__in=rows).values_list('round_id', 'signature'))
        items = []
        for row in rows:
            # During revision the applicant's single item already covers this round.
            # Self-assigned authors cannot review their reply until resubmission.
            if row.state == 'returned' and row.change.applicant_id == request.user.pk:
                continue
            tasks = row.tasks.filter(owner=request.user, confirmed_at__isnull=True).count() if row.state == 'pending' else 0
            replies = row.change.review_issues.filter(author=request.user, state='awaiting_review').count()
            approval = int(row.state == 'pending' and row.records.filter(reviewer=request.user, approval_required=True, approved_at__isnull=True).exists())
            if not tasks and not replies and not approval:
                continue
            latest = row.change.issue_events.filter(kind='respond', issue__author=request.user).exclude(author=request.user).aggregate(value=Max('id'))['value'] or 0
            ready = approval and not row.tasks.filter(confirmed_at__isnull=True).exists()
            signature = hashlib.sha256(json.dumps(['stage', row.pk, latest, bool(ready)]).encode()).hexdigest()
            items.append({'change_id': row.change_id, 'round': row.number, 'title': row.title, 'context': 'applicant' if row.change.applicant_id == request.user.pk else 'reviewer',
                'stage': row.change.stage, 'eco_no': row.eco_no,
                'ecr_no': row.ecr_no, 'status': row.state, 'count': tasks + replies + approval,
                'summary': f'{row.change.stage.upper()}行动待处理{tasks}项；意见回应待复核{replies}项' + ('；待本人同意批准' if ready else '；任务确认后待本人批准' if approval else ''), 'open_issues': bool(replies),
                'message_key': signature, 'is_read': reads.get(row.pk) == signature})
        return items

    def publication_items(self, request):
        rows = ReviewRound.objects.filter(change__stage__in=['ecr', 'eco'], number=F('change__current_review_round'),
            state='approved', change__status='approved', change__publisher=request.user).select_related('change')
        reads = dict(ReviewInboxRead.objects.filter(user=request.user, round__in=rows).values_list('round_id', 'signature'))
        return [{'change_id': row.change_id, 'round': row.number, 'stage': row.change.stage, 'title': row.title,
                 'context': 'publication',
                 'ecr_no': row.ecr_no, 'eco_no': row.eco_no, 'status': 'approved', 'count': 1,
                 'summary': f'{row.change.stage.upper()}已批准，待本人发布', 'open_issues': False,
                 'message_key': signature, 'is_read': reads.get(row.pk) == signature}
                for row in rows for signature in [hashlib.sha256(json.dumps(['publication', row.pk]).encode()).hexdigest()]]


class ReadItem(StrictValues):
    change_id = serializers.IntegerField(min_value=1)
    round = serializers.IntegerField(min_value=1)
    message_key = serializers.RegexField(r'^[0-9a-f]{64}$')


class ReadItems(StrictValues):
    items = ReadItem(many=True, allow_empty=False)

    def validate_items(self, items):
        if len({(item['change_id'], item['round']) for item in items}) != len(items):
            raise serializers.ValidationError('消息不能重复。')
        return items


class MarkInboxRead(APIView):
    permission_classes = [IsAuthenticated, ExpectedAccountPermission]
    http_method_names = ['post', 'options']

    def post(self, request):
        values = ReadItems(data=request.data)
        values.is_valid(raise_exception=True)
        requested = {item['change_id'] for item in values.validated_data['items']}
        allowed = {item['change_id'] for item in ReviewInbox().get(request).data['items']}
        if not requested <= allowed:
            return Response({'detail': '消息已变化或没有权限，请刷新后再标为已读。'}, status=409)
        with transaction.atomic():
            # Review writes lock the same parent. Serialize snapshots and receipts so an
            # older request cannot overwrite a newer read after an incoming reply.
            list(ChangeRequest.objects.select_for_update().filter(pk__in=requested).order_by('pk'))
            current = ReviewInbox().get(request).data
            messages = {(item['change_id'], item['round']): item for item in current['items']}
            for item in values.validated_data['items']:
                message = messages.get((item['change_id'], item['round']))
                if not message or message['message_key'] != item['message_key']:
                    return Response({'detail': '消息已变化或没有权限，请刷新后再标为已读。'}, status=409)
            for item in values.validated_data['items']:
                round = ReviewRound.objects.get(change_id=item['change_id'], number=item['round'])
                ReviewInboxRead.objects.update_or_create(user=request.user, round=round,
                                                        defaults={'signature': item['message_key']})
        return ReviewInbox().get(request)
