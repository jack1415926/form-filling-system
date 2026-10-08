from .review_access import readable_change
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.views import APIView

from .execution_plan import PLAN_ACTIVITIES, PLAN_ACTIVITY_IDS
from .models import ChangeRequest, ExecutionPlanResponse
from .dates import BusinessDateField


class PlanValueSerializer(serializers.ModelSerializer):
    start_date = BusinessDateField(required=False, allow_null=True)
    end_date = BusinessDateField(required=False, allow_null=True)

    class Meta:
        model = ExecutionPlanResponse
        fields = ["owner", "start_date", "end_date", "remark"]

    def to_internal_value(self, data):
        if not isinstance(data, dict):
            raise serializers.ValidationError({"detail": "填写内容必须是对象。"})
        forbidden = set(data) - set(self.Meta.fields)
        if forbidden:
            raise serializers.ValidationError({key: "此字段不允许修改。" for key in forbidden})
        for key in ["owner", "remark"]:
            if key in data and not isinstance(data[key], str):
                raise serializers.ValidationError({key: "必须是文本。"})
        return super().to_internal_value(data)

    def validate(self, fields):
        start = fields.get("start_date", self.instance.start_date)
        end = fields.get("end_date", self.instance.end_date)
        if start is not None and end is not None and end < start:
            raise serializers.ValidationError({"end_date": "结束日期不得早于开始日期。"})
        return fields


class PlanPatchSerializer(serializers.Serializer):
    responses = serializers.DictField(child=serializers.DictField(), allow_empty=True)

    def to_internal_value(self, data):
        if not isinstance(data, dict):
            raise serializers.ValidationError({"detail": "请求内容必须是对象。"})
        forbidden = set(data) - {"responses"}
        if forbidden:
            raise serializers.ValidationError({key: "此字段不允许修改。" for key in forbidden})
        return super().to_internal_value(data)

    def validate_responses(self, responses):
        invalid = set(responses) - set(PLAN_ACTIVITY_IDS)
        if invalid:
            raise serializers.ValidationError({key: "活动标识不合法。" for key in invalid})
        return responses


class ExecutionPlanDetail(APIView):
    allow_review_read = True
    http_method_names = ["get", "patch", "head", "options"]

    @staticmethod
    def data(record):
        saved = {row.activity_key: row for row in record.execution_plan_responses.all()}
        return {"updated_at": record.updated_at.isoformat(), "rows": [
            {**definition, **(PlanValueSerializer(saved[definition["id"]]).data if definition["id"] in saved
                             else {"owner": "", "start_date": None, "end_date": None, "remark": ""})}
            for definition in PLAN_ACTIVITIES
        ]}

    def get(self, request, pk):
        with transaction.atomic():
            record = readable_change(request, pk)
            return Response(self.data(record))

    def patch(self, request, pk):
        with transaction.atomic():
            record = get_object_or_404(ChangeRequest.objects.select_for_update(), pk=pk, applicant=request.user)
            if record.status not in [ChangeRequest.Status.DRAFT, ChangeRequest.Status.RETURNED]:
                return Response({"detail": "申请已锁定，不能修改执行计划。"}, status=409)
            payload = PlanPatchSerializer(data=request.data)
            payload.is_valid(raise_exception=True)
            existing = {row.activity_key: row for row in record.execution_plan_responses.all()}
            staged = []; errors = {}
            for key, values in payload.validated_data["responses"].items():
                instance = existing.get(key) or ExecutionPlanResponse(change=record, activity_key=key)
                serializer = PlanValueSerializer(instance, data=values, partial=True)
                if serializer.is_valid():
                    staged.append((instance, serializer.validated_data))
                else:
                    errors[key] = serializer.errors
            if errors:
                raise serializers.ValidationError({"responses": errors})
            changed = False
            for instance, fields in staged:
                if not any(getattr(instance, key) != value for key, value in fields.items()):
                    continue
                changed = True
                for key, value in fields.items():
                    setattr(instance, key, value)
                if instance.owner or instance.start_date or instance.end_date or instance.remark:
                    instance.save()
                elif instance.pk:
                    instance.delete()
            if changed:
                record.updated_at = timezone.now()
                record.save(update_fields=["updated_at"])
            return Response(self.data(record))
