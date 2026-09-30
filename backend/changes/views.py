import json

from django.contrib.auth import authenticate, login, logout
from django.db import transaction
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.shortcuts import get_object_or_404
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_POST
from rest_framework import generics, status
from rest_framework.response import Response

from .models import ChangeRequest
from .serializers import ChangeRequestSerializer


def user_data(user):
    return {"id": user.pk, "username": user.username, "display_name": user.get_full_name() or user.username}


@require_GET
@ensure_csrf_cookie
def csrf_view(request):
    return JsonResponse({"csrfToken": get_token(request)})


@require_POST
@csrf_protect
def login_view(request):
    try:
        data = json.loads(request.body)
    except (ValueError, UnicodeDecodeError):
        return JsonResponse({"detail": "请求内容格式错误。"}, status=400)
    if not isinstance(data, dict) or not all(isinstance(data.get(key), str) for key in ("username", "password")):
        return JsonResponse({"detail": "请输入用户名和密码。"}, status=400)
    user = authenticate(request, username=data["username"], password=data["password"])
    if user is None:
        return JsonResponse({"detail": "用户名或密码错误。"}, status=400)
    login(request, user)
    # Login rotates the token. Return the new token for subsequent write requests.
    return JsonResponse({"user": user_data(user), "csrfToken": get_token(request)})


@require_POST
@csrf_protect
def logout_view(request):
    logout(request)
    return JsonResponse({"detail": "已退出登录。", "csrfToken": get_token(request)})


@require_GET
def me_view(request):
    if not request.user.is_authenticated:
        return JsonResponse({"detail": "请先登录。"}, status=401)
    return JsonResponse(user_data(request.user))


class ChangeList(generics.ListCreateAPIView):
    serializer_class = ChangeRequestSerializer

    def get_queryset(self):
        return ChangeRequest.objects.filter(applicant=self.request.user)

    def perform_create(self, serializer):
        serializer.save(applicant=self.request.user, status=ChangeRequest.Status.DRAFT)


class ChangeDetail(generics.RetrieveUpdateAPIView):
    serializer_class = ChangeRequestSerializer
    http_method_names = ["get", "patch", "head", "options"]

    def get_queryset(self):
        return ChangeRequest.objects.filter(applicant=self.request.user)

    def patch(self, request, *args, **kwargs):
        with transaction.atomic():
            record = get_object_or_404(self.get_queryset().select_for_update(), pk=kwargs["pk"])
            if record.status != ChangeRequest.Status.DRAFT:
                return Response({"detail": "申请已锁定，不能修改表单。"}, status=status.HTTP_409_CONFLICT)
            serializer = self.get_serializer(record, data=request.data, partial=True)
            serializer.is_valid(raise_exception=True)
            serializer.save()
            return Response(serializer.data)
