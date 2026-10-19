import json

from django.http import HttpResponse
from django.middleware.csrf import CsrfViewMiddleware
from django.test import RequestFactory, SimpleTestCase
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.test import APIRequestFactory
from rest_framework.views import APIView

from .api_errors import csrf_failure, exception_handler


class ApiErrorTests(SimpleTestCase):
    def test_session_authentication_has_explicit_code_even_when_drf_uses_403(self):
        class Protected(APIView):
            permission_classes = [IsAuthenticated]

            def get(self, request):
                return Response({})

        response = Protected.as_view()(APIRequestFactory().get('/api/protected/'))
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data['code'], 'not_authenticated')

    def test_business_permission_denial_is_not_authentication_failure(self):
        response = exception_handler(PermissionDenied('没有本轮审核权限。'), {})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(str(response.data['detail']), '没有本轮审核权限。')
        self.assertNotIn('code', response.data)

    def test_drf_csrf_failure_has_explicit_code(self):
        response = exception_handler(PermissionDenied('CSRF Failed: CSRF token missing.'), {})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data['code'], 'csrf_failed')

    def test_django_csrf_middleware_returns_json_for_api_login(self):
        request = RequestFactory().post('/api/auth/login/', {})
        response = CsrfViewMiddleware(lambda request: HttpResponse()).process_view(request, lambda request: HttpResponse(), (), {})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(json.loads(response.content)['code'], 'csrf_failed')

    def test_non_api_csrf_failure_keeps_django_html_response(self):
        response = csrf_failure(RequestFactory().post('/admin/login/'), reason='CSRF cookie not set.')
        self.assertEqual(response.status_code, 403)
        self.assertIn('text/html', response['Content-Type'])
