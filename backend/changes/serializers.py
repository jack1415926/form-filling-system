from django.db import IntegrityError, transaction
from rest_framework import serializers

from .models import ChangeRequest

NUMBER_ERRORS = {"ecr_no": "ECR 编号已存在，请使用其他编号。", "eco_no": "ECO 编号已存在，请使用其他编号。"}


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

    def validate(self, attrs):
        errors = {}
        for field, message in NUMBER_ERRORS.items():
            if not attrs.get(field):
                continue
            duplicates = ChangeRequest.objects.filter(**{field: attrs[field]})
            if self.instance is not None:
                duplicates = duplicates.exclude(pk=self.instance.pk)
            if duplicates.exists():
                errors[field] = [message]
        if errors:
            raise serializers.ValidationError(errors)
        return attrs

    def save(self, **kwargs):
        try:
            with transaction.atomic():
                return super().save(**kwargs)
        except IntegrityError as error:
            # The database remains authoritative if another request wins the race.
            if len(error.args) > 1 and error.args[0] == 1062:
                key = str(error.args[1]).rsplit(" for key ", 1)[-1].strip("'`").rsplit(".", 1)[-1]
                for field, message in NUMBER_ERRORS.items():
                    if key == f"change_request_{field}_unique":
                        raise serializers.ValidationError({field: [message]}) from error
            raise

    def to_internal_value(self, data):
        if not isinstance(data, dict):
            raise serializers.ValidationError({"detail": "请求内容必须是对象。"})
        forbidden = set(data) - (set(self.Meta.fields) - set(self.Meta.read_only_fields))
        if forbidden:
            raise serializers.ValidationError({key: "此字段不允许修改。" for key in forbidden})
        return super().to_internal_value(data)
