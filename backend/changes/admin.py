from django.contrib import admin
from django.contrib.auth import get_user_model
from django.contrib.auth.admin import UserAdmin

from .roles import action_owner_references


class ProtectedUserAdmin(UserAdmin):
    def get_deleted_objects(self, objs, request):
        deleted, counts, permissions, protected = super().get_deleted_objects(objs, request)
        # 在后台确认页提前展示保护原因，避免提交删除后才由信号报错。
        protected.extend(str(row) for row in action_owner_references([user.pk for user in objs]))
        return deleted, counts, permissions, protected


User = get_user_model()
admin.site.unregister(User)
admin.site.register(User, ProtectedUserAdmin)
