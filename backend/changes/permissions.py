from rest_framework.exceptions import APIException
from rest_framework.permissions import BasePermission


def account_changed(request):
    expected = request.headers.get("X-Expected-User")
    return request.user.is_authenticated and expected is not None and expected != str(request.user.pk)


class ExpectedAccountPermission(BasePermission):
    def has_permission(self, request, view):
        if account_changed(request):
            error = APIException({"detail": "登录账号已变化，本次操作未执行。", "code": "account_changed"})
            error.status_code = 409
            raise error
        return True
