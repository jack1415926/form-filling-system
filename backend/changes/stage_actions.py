"""行动分配的读取与保存；权限校验及父申请锁由调用方负责。"""
from django.utils import timezone

from .ecr import ECR_ACTIONS
from .eco import ECO_ACTIONS
from .models import EcrActionResponse, EcoActionResponse


def stage_parts(record):
    return (ECO_ACTIONS, EcoActionResponse, record.eco_responses) if record.stage == 'eco' else (ECR_ACTIONS, EcrActionResponse, record.ecr_responses)


def action_data(record, answers=None):
    if answers is None:
        answers = dict(record.question_responses.values_list('number', 'answer'))
    definitions, _, relation = stage_parts(record)
    responses = {row.action_key: row for row in relation.prefetch_related('owners')}
    actions = []
    for definition in definitions:
        row = responses.get(definition['id'])
        # 复用预加载的人员集合，在内存排序，避免逐行动查询负责人。
        owners = sorted(row.owners.all(), key=lambda user: user.pk) if row else []
        actions.append({**definition, 'question_answer': answers.get(definition['number'], ''),
            'extra_required': bool(row and row.extra_required), 'required': answers.get(definition['number']) == 'Y' or bool(row and row.extra_required),
            'owner_user_ids': [u.pk for u in owners],
            'owner_users': [{'id': u.pk, 'display_name': u.get_full_name() or u.username, 'is_active': u.is_active} for u in owners],
            'owner_name': '、'.join(u.get_full_name() or u.username for u in owners),
            'owner_active': bool(owners) and all(u.is_active for u in owners)})
    return actions


def task_data(task, actor, record):
    current = task.round.number == record.current_review_round
    editable = current and record.status == 'pending' and task.round.state == 'pending' and task.owner_id == actor.pk and actor.is_active and task.confirmed_at is None
    # operations.all()复用批量预加载；改成filter/values_list会重新逐任务发起SQL。
    # 回执仍按操作者筛选，不能因为批量读取就暴露其他人的操作标识。
    return {'id': task.pk, 'round': task.round.number, 'action_key': task.action_key,
            'owner_id': task.owner_id, 'owner_name': task.owner.get_full_name() or task.owner.username,
            'result': task.result, 'status': task.status, 'date': task.date.isoformat() if task.date else None,
            'version': task.version, 'confirmed_at': task.confirmed_at.isoformat() if task.confirmed_at else None,
            'can_edit': editable,
            'confirmed_requests': [str(operation.request_id) for operation in task.operations.all() if operation.author_id == actor.pk]}


def save_action_assignment(record, serializer):
    # 调用方已验证输入并持有父申请锁，这里只保存实际变化的分配。
    instance, fields = serializer.instance, serializer.validated_data
    if any((set(instance.owners.values_list('pk', flat=True)) if instance.pk else set()) != {user.pk for user in value} if key == 'owners' else getattr(instance, key) != value for key, value in fields.items()):
        if not instance.pk:
            instance.save()
        serializer.save()
        if not (instance.owners.exists() or instance.extra_required or instance.result or instance.status or instance.date):
            instance.delete()
        record.updated_at = timezone.now()
        record.save(update_fields=['updated_at'])
