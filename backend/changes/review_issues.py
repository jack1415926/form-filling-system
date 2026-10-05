import json

from rest_framework import serializers
from rest_framework.exceptions import APIException

from .models import ReviewIssue, ReviewIssueEvent
from .roles import business_role


TABS = ['overview', 'materials', 'questions', 'ecr', 'eco', 'emc', 'execution-plan', 'significant-change']


def conflict(message):
    error = APIException(message)
    error.status_code = 409
    raise error


class StrictValues(serializers.Serializer):
    def to_internal_value(self, data):
        if not isinstance(data, dict):
            raise serializers.ValidationError('请求内容必须是对象。')
        extra = set(data) - set(self.fields)
        if extra:
            raise serializers.ValidationError({key: '此字段不允许修改。' for key in extra})
        for key, field in self.fields.items():
            if key in data and isinstance(field, serializers.IntegerField) and type(data[key]) is not int:
                raise serializers.ValidationError({key: '必须为整数。'})
            if key in data and isinstance(field, serializers.CharField) and not isinstance(data[key], str):
                raise serializers.ValidationError({key: '必须为文字。'})
        return super().to_internal_value(data)


class IssueValues(StrictValues):
    tab = serializers.ChoiceField(choices=TABS, required=False)
    location = serializers.CharField(max_length=255, allow_blank=True, required=False, default='')
    text = serializers.CharField(max_length=10000)
    issue_id = serializers.IntegerField(min_value=1, required=False)
    version = serializers.IntegerField(min_value=1, required=False)

    def validate(self, values):
        if 'issue_id' in values:
            if 'version' not in values or 'tab' in values or values['location']:
                raise serializers.ValidationError('继续修改必须携带意见版本，不能改动原意见位置。')
        elif 'tab' not in values or 'version' in values:
            raise serializers.ValidationError('新意见必须注明所属页签。')
        return values


class ReturnValues(StrictValues):
    request_id = serializers.UUIDField()
    issues = IssueValues(many=True, allow_empty=False)

    def validate_issues(self, values):
        ids = [row['issue_id'] for row in values if 'issue_id' in row]
        if len(ids) != len(set(ids)):
            raise serializers.ValidationError('同一意见不能在退回清单重复。')
        return values


class IssueActionValues(StrictValues):
    request_id = serializers.UUIDField()
    issue_id = serializers.IntegerField(min_value=1)
    version = serializers.IntegerField(min_value=1)
    text = serializers.CharField(max_length=10000)


class ApproveValues(StrictValues):
    request_id = serializers.UUIDField()


def blockers(record):
    pending = record.review_issues.exclude(state='resolved').select_related('author')
    reasons = []
    if pending.filter(state='awaiting_reply').exists():
        reasons.append('请逐条提交全部未解决意见的回应，再重新提交申请。')
    if any(not row.author.is_active or business_role(row.author) != 'reviewer' for row in pending):
        reasons.append('有未解决意见的原提出者已停用或失去审核员身份，请联系账号管理员恢复身份。')
    return reasons


def issue_data(record, viewed_round, user, owner, reviewer, current):
    rows = []
    round_numbers = dict(record.review_rounds.filter(number__lte=viewed_round.number).values_list('id', 'number'))
    # Old-round viewers must not receive responses or decisions from later rounds.
    for issue in record.review_issues.filter(source_round__number__lte=viewed_round.number).select_related('author', 'source_round').prefetch_related('events__author').order_by('id'):
        events = sorted((event for event in issue.events.all() if event.round_id in round_numbers), key=lambda event: event.pk)
        if not events:
            continue
        last = events[-1]
        rows.append({'id': issue.pk, 'tab': issue.tab, 'location': issue.location, 'text': issue.text,
                     'source_round': issue.source_round.number, 'author': {'id': issue.author_id, 'username': issue.author.username, 'display_name': issue.author.get_full_name() or issue.author.username},
                     'state': last.state, 'version': last.version,
                     'can_respond': current and owner and record.status == 'returned' and issue.state != 'resolved',
                     'can_resolve': current and reviewer and record.status == 'pending' and issue.author_id == user.pk and issue.state == 'awaiting_review',
                     'can_reject': current and reviewer and record.status == 'pending' and issue.author_id == user.pk and issue.state != 'resolved',
                     'events': [{'kind': event.kind, 'text': event.text, 'state': event.state, 'version': event.version,
                                 'round_number': round_numbers[event.round_id],
                                 'author_id': event.author_id, 'request_id': str(event.request_id), 'created_at': event.created_at.isoformat()} for event in events]})
    return rows


def canonical(values):
    return json.loads(json.dumps(values, default=str))


def replay(record, user, kind, values):
    previous = record.issue_events.filter(author=user, request_id=values['request_id']).order_by('position').first()
    if previous:
        if previous.kind != kind or previous.payload != canonical(values):
            conflict('同一请求标识携带了不同动作或内容，请核对原请求。')
        return True
    return False


def event(record, round, user, kind, values, issue=None, text='', position=0):
    ReviewIssueEvent.objects.create(change=record, round=round, author=user, issue=issue, kind=kind,
        text=text, state=issue.state if issue else '', version=issue.version if issue else 0,
        request_id=values['request_id'], payload=canonical(values), position=position)


def checked_issue(record, user, values, owner=False):
    issue = record.review_issues.filter(pk=values['issue_id']).first()
    if not issue or not owner and issue.author_id != user.pk:
        conflict('意见不存在或不是本人提出的意见。')
    if issue.version != values['version']:
        conflict('意见已变化，请刷新后核对，未发送文字仍保留。')
    if issue.state == 'resolved':
        conflict('意见已解决，需要时请提出新意见。')
    return issue


def return_issues(record, round, user, values):
    # Validate all existing items before creating any item; caller also holds the transaction.
    existing = {row['issue_id']: checked_issue(record, user, row) for row in values['issues'] if 'issue_id' in row}
    for index, row in enumerate(values['issues']):
        if 'issue_id' in row:
            issue = existing[row['issue_id']]
            issue.state = 'awaiting_reply'; issue.version += 1
            issue.save(update_fields=['state', 'version'])
        else:
            issue = ReviewIssue.objects.create(change=record, source_round=round, author=user,
                tab=row['tab'], location=row['location'], text=row['text'])
        event(record, round, user, 'return', values, issue, row['text'], index)
    return '\n'.join(row['text'] for row in values['issues'])
