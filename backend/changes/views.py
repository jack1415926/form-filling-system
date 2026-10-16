from .review_access import readable_change, editable_change
import json

from django.contrib.auth import authenticate, login, logout
from django.conf import settings
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

from .models import ChangeRequest, MaterialChange, QuestionResponse, EcrActionResponse, EcoActionResponse
from .serializers import ChangeRequestSerializer, MaterialChangeSerializer, QuestionPatchSerializer, EcrActionSerializer, EcoActionSerializer
from .ecr import ECR_ACTIONS, ECR_ACTION_IDS
from .eco import ECO_ACTIONS, ECO_ACTION_IDS
from .questions import QUESTIONS
from .dispositions import LOCATIONS
from .permissions import account_changed
from .roles import can_manage_feedback, can_review
from rest_framework import serializers


class DeleteChangeValues(serializers.Serializer):
    confirm_delete = serializers.BooleanField(default=False)
    delete_eco = serializers.BooleanField(default=False)
    expected_eco_id = serializers.IntegerField(min_value=1, allow_null=True, required=False)

    def to_internal_value(self, data):
        if not isinstance(data, dict) or set(data) - set(self.fields):
            raise serializers.ValidationError({'detail': '删除请求格式错误或包含未知字段。'})
        if data.get('expected_eco_id') is not None and type(data['expected_eco_id']) is not int:
            raise serializers.ValidationError({'expected_eco_id': '必须为整数或空值。'})
        return super().to_internal_value(data)

    def validate(self, values):
        for field in ['confirm_delete', 'delete_eco']:
            if field in self.initial_data and type(self.initial_data[field]) is not bool:
                raise serializers.ValidationError({field: '必须为布尔值。'})
        return values


def user_data(user):
    return {"id": user.pk, "username": user.username, "display_name": user.get_full_name() or user.username, "can_review": can_review(user), "can_manage_feedback": can_manage_feedback(user), "can_generate_test_data": settings.DEBUG}


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

    def create(self, request, *args, **kwargs):
        with transaction.atomic():
            return super().create(request, *args, **kwargs)

    def get_queryset(self):
        return ChangeRequest.objects.filter(applicant=self.request.user, stage__in=['ecr', 'eco'])

    def perform_create(self, serializer):
        serializer.save(applicant=self.request.user, stage='ecr', status=ChangeRequest.Status.DRAFT)


class ChangeDetail(generics.RetrieveUpdateAPIView):
    allow_review_read = True
    serializer_class = ChangeRequestSerializer
    http_method_names = ["get", "patch", "delete", "head", "options"]

    def get_queryset(self):
        return ChangeRequest.objects.filter(applicant=self.request.user)

    def get(self, request, *args, **kwargs):
        with transaction.atomic():
            return Response(self.get_serializer(readable_change(request, kwargs['pk'])).data)

    def patch(self, request, *args, **kwargs):
        with transaction.atomic():
            record = editable_change(request, kwargs["pk"])
            if record.status not in [ChangeRequest.Status.DRAFT, ChangeRequest.Status.RETURNED]:
                return Response({"detail": "申请已锁定，不能修改表单。"}, status=status.HTTP_409_CONFLICT)
            serializer = self.get_serializer(record, data=request.data, partial=True)
            serializer.is_valid(raise_exception=True)
            serializer.save()
            return Response(serializer.data)

    def delete(self, request, *args, **kwargs):
        values = DeleteChangeValues(data=request.data)
        values.is_valid(raise_exception=True)
        data = values.validated_data
        with transaction.atomic():
            if not request.user.is_active:
                return Response({'detail': '申请不存在或没有删除权限。'}, status=404)
            record = editable_change(request, kwargs["pk"])
            if record.stage == 'eco':
                return Response({'detail': '请由来源ECR发起人从ECR入口删除整项工程变更。'}, status=409)
            if record.status != ChangeRequest.Status.DRAFT and not data['confirm_delete']:
                return Response({'detail': '请确认永久删除整项工程变更及其历史记录。'}, status=409)
            eco = ChangeRequest.objects.select_for_update().filter(source_ecr=record).first()
            if 'expected_eco_id' in data and data['expected_eco_id'] != (eco.pk if eco else None):
                return Response({'detail': '关联ECO已变化，请刷新列表后重新确认删除范围。'}, status=409)
            if eco:
                if not data['confirm_delete'] or not data['delete_eco'] or data.get('expected_eco_id') != eco.pk:
                    return Response({'detail': '此ECR有关联ECO，必须确认同时删除该ECO；否则保留整个工程变更。'}, status=409)
                eco.delete()
            record.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)


class MaterialList(APIView):
    allow_review_read = True
    def get(self, request, pk):
        # ponytail: serialize this application's reads/writes; use a snapshot if contention becomes measurable.
        with transaction.atomic():
            record = readable_change(request, pk)
            return Response(MaterialChangeSerializer(record.materials.prefetch_related("dispositions"), many=True).data)

    def post(self, request, pk):
        return self.write(request, pk)

    def write(self, request, pk, material_pk=None):
        with transaction.atomic():
            record = editable_change(request, pk)
            if record.status not in [ChangeRequest.Status.DRAFT, ChangeRequest.Status.RETURNED]:
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
    allow_review_read = True
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
            record = readable_change(request, pk)
            return Response(self.data(record))

    def patch(self, request, pk):
        with transaction.atomic():
            record = editable_change(request, pk)
            if record.status not in [ChangeRequest.Status.DRAFT, ChangeRequest.Status.RETURNED]:
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
    allow_review_read = True
    http_method_names = ["get", "head", "options"]

    @staticmethod
    def data(record):
        answers = dict(record.question_responses.values_list("number", "answer"))
        responses = {row.action_key: row for row in record.ecr_responses.select_related('owner_user').all()}
        results = {}
        if record.stage == 'ecr' and record.status == 'published':
            round = record.review_rounds.filter(number=record.current_review_round).first()
            if round:
                for task in round.tasks.filter(confirmed_at__isnull=False).select_related('owner').order_by('action_key', 'owner_id'):
                    user = task.owner
                    results.setdefault(task.action_key, []).append({'id': task.pk, 'round': round.number,
                        'owner': {'id': user.pk, 'username': user.username, 'display_name': user.get_full_name() or user.username, 'is_active': user.is_active},
                        'result': task.result, 'status': task.status, 'date': task.date.isoformat() if task.date else None,
                        'confirmed_at': task.confirmed_at.isoformat()})
        return {"updated_at": record.updated_at.isoformat(), "actions": [
            {**definition, "question_answer": answers.get(definition["number"], ""),
             "task_results": results.get(definition["id"], []),
             **(EcrActionSerializer(responses[definition["id"]]).data if definition["id"] in responses else {"owner": "", "owner_user_id": None, "owner_user": None, "owner_user_ids": [], "owner_users": [], "extra_required": False, "result": "", "status": "", "date": None})}
            for definition in ECR_ACTIONS
        ]}

    def get(self, request, pk):
        with transaction.atomic():
            record = readable_change(request, pk)
            if record.stage == 'eco':
                return Response({**self.data(record.source_ecr), 'source_ecr_id': record.source_ecr_id})
            return Response(self.data(record))


class EcrActionDetail(APIView):
    http_method_names = ["patch", "options"]

    def patch(self, request, pk, action_key):
        with transaction.atomic():
            record = editable_change(request, pk)
            if record.stage == 'eco':
                return Response({'detail': '来源ECR评估只读。'}, status=409)
            if action_key not in ECR_ACTION_IDS:
                return Response({"detail": "行动不存在。"}, status=404)
            if record.status not in [ChangeRequest.Status.DRAFT, ChangeRequest.Status.RETURNED]:
                return Response({"detail": "申请已锁定，不能修改 ECR 评估。"}, status=409)
            if record.stage == 'ecr' and (not isinstance(request.data, dict) or set(request.data) - {'owner_user_id', 'owner_user_ids', 'extra_required'}):
                return Response({'detail': '发起人仅可分配负责人和补充任务；结果由负责人在处理中填写。'}, status=400)
            if isinstance(request.data, dict) and 'extra_required' in request.data and type(request.data['extra_required']) is not bool:
                return Response({'detail': '补充任务标记必须为布尔值。'}, status=400)
            existing = record.ecr_responses.filter(action_key=action_key).first()
            instance = existing or EcrActionResponse(change=record, action_key=action_key)
            serializer = EcrActionSerializer(instance, data=request.data, partial=True)
            serializer.is_valid(raise_exception=True)
            fields = serializer.validated_data
            if any((set(instance.owners.values_list('pk', flat=True)) if instance.pk else set()) != {user.pk for user in value} if key == 'owners' else getattr(instance, key) != value for key, value in fields.items()):
                if not instance.pk:
                    instance.save()
                serializer.save()
                if not (instance.owner or instance.owner_user_id or instance.owners.exists() or instance.extra_required or instance.result or instance.status or instance.date):
                    instance.delete()
                record.updated_at = timezone.now()
                record.save(update_fields=["updated_at"])
            return Response(EcrActionList.data(record))


class EcoActionList(APIView):
    allow_review_read = True
    http_method_names = ["get", "head", "options"]

    @staticmethod
    def data(record):
        answers = dict(record.question_responses.values_list("number", "answer"))
        responses = {row.action_key: row for row in record.eco_responses.select_related('owner_user').all()}
        return {"updated_at": record.updated_at.isoformat(), "actions": [
            {**definition, "question_answer": answers.get(definition["number"], ""),
             **(EcoActionSerializer(responses[definition["id"]]).data if definition["id"] in responses else {"owner": "", "owner_user_id": None, "owner_user": None, "owner_user_ids": [], "owner_users": [], "extra_required": False, "result": "", "status": "", "date": None})}
            for definition in ECO_ACTIONS
        ]}

    def get(self, request, pk):
        with transaction.atomic():
            record = readable_change(request, pk)
            return Response(self.data(record))


class EcoActionDetail(APIView):
    http_method_names = ["patch", "options"]

    def patch(self, request, pk, action_key):
        with transaction.atomic():
            record = editable_change(request, pk)
            if record.stage == 'ecr':
                return Response({'detail': 'ECO阶段尚未启动。'}, status=409)
            if record.stage == 'eco' and (not isinstance(request.data, dict) or set(request.data) - {'owner_user_id', 'owner_user_ids', 'extra_required'}):
                return Response({'detail': '草稿／退回时仅可分配ECO负责人及补充任务，结果由提交后的负责人填写。'}, status=400)
            if isinstance(request.data, dict) and 'extra_required' in request.data and type(request.data['extra_required']) is not bool:
                return Response({'detail': '补充任务标记必须为布尔值。'}, status=400)
            if action_key not in ECO_ACTION_IDS:
                return Response({"detail": "行动不存在。"}, status=404)
            if record.status not in [ChangeRequest.Status.DRAFT, ChangeRequest.Status.RETURNED]:
                return Response({"detail": "申请已锁定，不能修改 ECO 执行。"}, status=409)
            existing = record.eco_responses.filter(action_key=action_key).first()
            instance = existing or EcoActionResponse(change=record, action_key=action_key)
            serializer = EcoActionSerializer(instance, data=request.data, partial=True)
            serializer.is_valid(raise_exception=True)
            fields = serializer.validated_data
            if any((set(instance.owners.values_list('pk', flat=True)) if instance.pk else set()) != {user.pk for user in value} if key == 'owners' else getattr(instance, key) != value for key, value in fields.items()):
                if not instance.pk:
                    instance.save()
                serializer.save()
                if not (instance.owner or instance.owner_user_id or instance.owners.exists() or instance.extra_required or instance.result or instance.status or instance.date):
                    instance.delete()
                record.updated_at = timezone.now()
                record.save(update_fields=["updated_at"])
            return Response(EcoActionList.data(record))
