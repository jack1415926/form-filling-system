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
from rest_framework.views import APIView
from django.utils import timezone

from .models import ChangeRequest, MaterialChange
from .serializers import ChangeRequestSerializer, MaterialChangeSerializer
from .dispositions import LOCATIONS
from .permissions import account_changed


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
    if account_changed(request):
        return JsonResponse({"detail": "登录账号已变化，本次操作未执行。", "code": "account_changed"}, status=409)
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
    http_method_names = ["get", "patch", "delete", "head", "options"]

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

    def delete(self, request, *args, **kwargs):
        with transaction.atomic():
            record = get_object_or_404(self.get_queryset().select_for_update(), pk=kwargs["pk"])
            if record.status != ChangeRequest.Status.DRAFT:
                return Response({"detail": "只能删除草稿申请。"}, status=status.HTTP_409_CONFLICT)
            record.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)


class MaterialList(APIView):
    def get(self, request, pk):
        # ponytail: serialize this application's reads/writes; use a snapshot if contention becomes measurable.
        with transaction.atomic():
            record = get_object_or_404(ChangeRequest.objects.select_for_update(), pk=pk, applicant=request.user)
            return Response(MaterialChangeSerializer(record.materials.prefetch_related("dispositions"), many=True).data)

    def post(self, request, pk):
        return self.write(request, pk)

    def write(self, request, pk, material_pk=None):
        with transaction.atomic():
            record = get_object_or_404(ChangeRequest.objects.select_for_update(), pk=pk, applicant=request.user)
            if record.status != ChangeRequest.Status.DRAFT:
                return Response({"detail": "申请已锁定，不能修改物料。"}, status=status.HTTP_409_CONFLICT)
            material = get_object_or_404(MaterialChange, pk=material_pk, change=record) if material_pk is not None else None
            if request.method == "DELETE":
                material.delete()
                result = Response(status=status.HTTP_204_NO_CONTENT)
            else:
                serializer = MaterialChangeSerializer(material, data=request.data, partial=material is not None)
                serializer.is_valid(raise_exception=True)
                request_id = serializer.validated_data.get("request_id")
                if material is None and request_id is not None:
                    existing = record.materials.filter(request_id=request_id).first()
                    if existing is not None:
                        fields = serializer.common_fields | serializer.category_fields[serializer.validated_data["category"]] | {"category"}
                        if any(getattr(existing, field) != serializer.validated_data.get(field, "") for field in fields):
                            return Response({"detail": "该新增请求已保存，但本次内容不同。请保留当前输入，再重新打开已保存物料编辑。"}, status=status.HTTP_409_CONFLICT)
                        stored = MaterialChangeSerializer(existing).data["dispositions"]
                        incoming = serializer.validated_data.get("dispositions", {})
                        if any(stored.get(key, {}).get(field, "") != incoming.get(key, {}).get(field, "") for key in LOCATIONS for field in ("disposition", "remark")):
                            return Response({"detail": "该新增请求已保存，但处置内容不同。请保留当前输入，再重新打开已保存物料编辑。"}, status=status.HTTP_409_CONFLICT)
                        return Response(MaterialChangeSerializer(existing).data)
                serializer.save(change=record)
                result = Response(serializer.data, status=status.HTTP_200_OK if material else status.HTTP_201_CREATED)
            record.updated_at = timezone.now()
            record.save(update_fields=["updated_at"])
            return result


class MaterialDetail(MaterialList):
    http_method_names = ["patch", "delete", "options"]

    def patch(self, request, pk, material_pk):
        return self.write(request, pk, material_pk)

    def delete(self, request, pk, material_pk):
        return self.write(request, pk, material_pk)
