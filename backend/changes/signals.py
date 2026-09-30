from django.contrib.auth.signals import user_logged_in
from django.contrib.sessions.models import Session
from django.db import transaction
from django.dispatch import receiver
from django.utils import timezone


@receiver(user_logged_in, dispatch_uid="changes.one_active_login")
def replace_previous_login(sender, request, user, **kwargs):
    # Serialize logins for this user without changing the built-in user model.
    with transaction.atomic():
        sender.objects.select_for_update().get(pk=user.pk)
        request.session.cycle_key()
        request.session.save()
        # ponytail: decode active DB sessions on login; add a user-session index
        # if the active-session count grows beyond this internal MVP.
        obsolete = [
            session.session_key
            for session in Session.objects.filter(expire_date__gt=timezone.now()).exclude(
                session_key=request.session.session_key
            )
            if str(session.get_decoded().get("_auth_user_id")) == str(user.pk)
        ]
        Session.objects.filter(session_key__in=obsolete).delete()
