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

from .models import ChangeRequest, MaterialChange, QuestionResponse, EcrActionResponse
from .serializers import ChangeRequestSerializer, MaterialChangeSerializer, QuestionPatchSerializer, EcrActionSerializer
from .ecr import ECR_ACTIONS, ECR_ACTION_IDS
from .questions import QUESTIONS
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


class QuestionList(APIView):
    http_method_names = ["get", "patch", "head", "options"]

    @staticmethod
    def data(record):
        values = {row.number: row for row in record.question_responses.all()}
        return {
            "updated_at": record.updated_at.isoformat(),
            "questions": [
                {**question,
                 "answer": values[question["number"]].answer if question["number"] in values else "",
                 "remark": values[question["number"]].remark if question["number"] in values else ""}
                for question in QUESTIONS
            ],
        }

    def get(self, request, pk):
        with transaction.atomic():
            record = get_object_or_404(ChangeRequest.objects.select_for_update(), pk=pk, applicant=request.user)
            return Response(self.data(record))

    def patch(self, request, pk):
        with transaction.atomic():
            record = get_object_or_404(ChangeRequest.objects.select_for_update(), pk=pk, applicant=request.user)
            if record.status != ChangeRequest.Status.DRAFT:
                return Response({"detail": "申请已锁定，不能修改问题回答。"}, status=status.HTTP_409_CONFLICT)
            serializer = QuestionPatchSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            changed = False
            for key, fields in serializer.validated_data["responses"].items():
                if not fields:
                    continue
                number = int(key)
                existing = record.question_responses.filter(number=number).first()
                answer = fields.get("answer", existing.answer if existing else "")
                remark = fields.get("remark", existing.remark if existing else "")
                if (answer, remark) == (existing.answer if existing else "", existing.remark if existing else ""):
                    continue
                if not answer and not remark:
                    existing.delete()
                else:
                    QuestionResponse.objects.update_or_create(change=record, number=number, defaults={"answer": answer, "remark": remark})
                changed = True
            if changed:
                record.updated_at = timezone.now()
                record.save(update_fields=["updated_at"])
            return Response(self.data(record))


class EcrActionList(APIView):
    http_method_names = ["get", "head", "options"]

    @staticmethod
    def data(record):
        answers = dict(record.question_responses.values_list("number", "answer"))
        responses = {row.action_key: row for row in record.ecr_responses.all()}
        return {"updated_at": record.updated_at.isoformat(), "actions": [
            {**definition, "question_answer": answers.get(definition["number"], ""),
             **(EcrActionSerializer(responses[definition["id"]]).data if definition["id"] in responses else {"owner": "", "result": "", "status": "", "date": None})}
            for definition in ECR_ACTIONS
        ]}

    def get(self, request, pk):
        with transaction.atomic():
            record = get_object_or_404(ChangeRequest.objects.select_for_update(), pk=pk, applicant=request.user)
            return Response(self.data(record))


class EcrActionDetail(APIView):
    http_method_names = ["patch", "options"]

    def patch(self, request, pk, action_key):
        with transaction.atomic():
            record = get_object_or_404(ChangeRequest.objects.select_for_update(), pk=pk, applicant=request.user)
            if action_key not in ECR_ACTION_IDS:
                return Response({"detail": "行动不存在。"}, status=404)
            if record.status != ChangeRequest.Status.DRAFT:
                return Response({"detail": "申请已锁定，不能修改 ECR 评估。"}, status=409)
            existing = record.ecr_responses.filter(action_key=action_key).first()
            instance = existing or EcrActionResponse(change=record, action_key=action_key)
            serializer = EcrActionSerializer(instance, data=request.data, partial=True)
            serializer.is_valid(raise_exception=True)
            fields = serializer.validated_data
            if any(getattr(instance, key) != value for key, value in fields.items()):
                for key, value in fields.items():
                    setattr(instance, key, value)
                if not (instance.owner or instance.result or instance.status or instance.date):
                    instance.delete()
                else:
                    instance.save()
                record.updated_at = timezone.now()
                record.save(update_fields=["updated_at"])
            return Response(EcrActionList.data(record))
