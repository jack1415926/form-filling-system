from rest_framework import serializers

from .models import ChangeRequest


class ChangeRequestSerializer(serializers.ModelSerializer):
    class Meta:
        model = ChangeRequest
        fields = [
            "id", "applicant", "status", "created_at", "updated_at",
            "title", "ecr_no", "eco_no", "affected_products", "affected_region",
            "initiating_factory", "affected_factories", "ccb_owner", "change_owner",
            "planned_eco_date", "change_reason",
        ]
        read_only_fields = ["id", "applicant", "status", "created_at", "updated_at"]

    def to_internal_value(self, data):
        if not isinstance(data, dict):
            raise serializers.ValidationError({"detail": "请求内容必须是对象。"})
        forbidden = set(data) - (set(self.Meta.fields) - set(self.Meta.read_only_fields))
        if forbidden:
            raise serializers.ValidationError({key: "此字段不允许修改。" for key in forbidden})
        return super().to_internal_value(data)
