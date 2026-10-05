from rest_framework.exceptions import APIException
from rest_framework.permissions import BasePermission
from .roles import business_role


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


class FillerPermission(BasePermission):
    def has_permission(self, request, view):
        if business_role(request.user) != 'filler':
            if request.method in ['GET', 'HEAD'] and getattr(view, 'allow_review_read', False):
                return True
            error = APIException({'detail': '当前账号为审核员，不能访问填写员功能。', 'code': 'role_forbidden'})
            error.status_code = 403
            raise error
        return True
