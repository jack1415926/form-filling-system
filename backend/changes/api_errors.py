from django.http import JsonResponse
from django.views.csrf import csrf_failure as default_csrf_failure
from rest_framework.exceptions import AuthenticationFailed, NotAuthenticated, PermissionDenied
from rest_framework.views import exception_handler as default_exception_handler


def exception_handler(exc, context):
    response = default_exception_handler(exc, context)
    if response is not None and isinstance(response.data, dict):
        if isinstance(exc, (NotAuthenticated, AuthenticationFailed)):
            response.data['code'] = 'not_authenticated'
        elif isinstance(exc, PermissionDenied) and str(exc.detail).startswith('CSRF Failed:'):
            response.data['code'] = 'csrf_failed'
    return response


def csrf_failure(request, reason=''):
    if request.path.startswith('/api/'):
        return JsonResponse({'detail': '安全校验失败，请使用原账号重新登录后重试。', 'code': 'csrf_failed'}, status=403)
    return default_csrf_failure(request, reason=reason)
