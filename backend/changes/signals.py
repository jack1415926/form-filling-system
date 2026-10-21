from django.contrib.auth.signals import user_logged_in
from django.contrib.sessions.models import Session
from django.db import transaction
from django.dispatch import receiver
from django.utils import timezone
from django.conf import settings
from django.db.models.signals import pre_delete
from django.db.models.deletion import ProtectedError

from .roles import action_owner_references


@receiver(pre_delete, sender=settings.AUTH_USER_MODEL, dispatch_uid='changes.protect_action_owners')
def protect_action_owners(sender, instance, **kwargs):
    # 单负责人外键删除后，仍须阻止删账号时静默清空当前的多人分配。
    references = action_owner_references([instance.pk])
    if references:
        raise ProtectedError('账号仍是行动负责人，请先调整分配或停用账号。', references)


@receiver(user_logged_in, dispatch_uid="changes.one_active_login")
def replace_previous_login(sender, request, user, **kwargs):
    # 同一账号的登录串行处理，避免两个并发登录都保留有效会话。
    with transaction.atomic():
        sender.objects.select_for_update().get(pk=user.pk)
        request.session.cycle_key()
        request.session.save()
        # ponytail: 内部MVP在登录时遍历有效会话；活跃会话量明显增长后再增加用户会话索引。
        obsolete = [
            session.session_key
            for session in Session.objects.filter(expire_date__gt=timezone.now()).exclude(
                session_key=request.session.session_key
            )
            if str(session.get_decoded().get("_auth_user_id")) == str(user.pk)
        ]
        Session.objects.filter(session_key__in=obsolete).delete()
