from django.db import IntegrityError, transaction
from rest_framework import serializers

from .models import ChangeRequest, MaterialChange, MaterialDisposition, EcrActionResponse
from .dispositions import LOCATIONS, DISPOSITIONS
from .questions import QUESTIONS

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


class DispositionValueSerializer(serializers.Serializer):
    disposition = serializers.ChoiceField(choices=DISPOSITIONS, required=False, allow_blank=True)
    remark = serializers.CharField(required=False, allow_blank=True)

    def to_internal_value(self, data):
        if not isinstance(data, dict) or set(data) - {"disposition", "remark"}:
            raise serializers.ValidationError("处置仅接受处置方式和备注。")
        return super().to_internal_value(data)


class QuestionValueSerializer(serializers.Serializer):
    answer = serializers.ChoiceField(choices=["", "Y", "N"], required=False)
    remark = serializers.CharField(required=False, allow_blank=True)

    def to_internal_value(self, data):
        if not isinstance(data, dict):
            raise serializers.ValidationError("回答必须是对象。")
        forbidden = set(data) - {"answer", "remark"}
        if forbidden:
            raise serializers.ValidationError({key: "此字段不允许修改。" for key in forbidden})
        # CharField normally coerces numbers to strings; remarks must be text.
        if "remark" in data and data["remark"] is not None and not isinstance(data["remark"], str):
            raise serializers.ValidationError({"remark": "备注必须是文本。"})
        return super().to_internal_value(data)


class EcrActionSerializer(serializers.ModelSerializer):
    class Meta:
        model = EcrActionResponse
        fields = ["owner", "result", "status", "date"]

    def to_internal_value(self, data):
        if not isinstance(data, dict):
            raise serializers.ValidationError({"detail": "请求内容必须是对象。"})
        forbidden = set(data) - set(self.Meta.fields)
        if forbidden:
            raise serializers.ValidationError({key: "此字段不允许修改。" for key in forbidden})
        for field in ("owner", "result"):
            if field in data and data[field] is not None and not isinstance(data[field], str):
                raise serializers.ValidationError({field: "必须是文本。"})
        return super().to_internal_value(data)


class QuestionPatchSerializer(serializers.Serializer):
    responses = serializers.DictField(child=QuestionValueSerializer(), allow_empty=True)

    def to_internal_value(self, data):
        if not isinstance(data, dict):
            raise serializers.ValidationError({"detail": "请求内容必须是对象。"})
        forbidden = set(data) - {"responses"}
        if forbidden:
            raise serializers.ValidationError({key: "此字段不允许修改。" for key in forbidden})
        if isinstance(data.get("responses"), dict):
            invalid = set(data["responses"]) - {str(question["number"]) for question in QUESTIONS}
            if invalid:
                raise serializers.ValidationError({"responses": {key: "题号不合法。" for key in invalid}})
        return super().to_internal_value(data)


class MaterialChangeSerializer(serializers.ModelSerializer):
    dispositions = serializers.DictField(child=DispositionValueSerializer(), required=False, write_only=True)
    request_id = serializers.UUIDField(write_only=True, required=False)
    category_fields = {
        "revision": {"old_revision", "new_revision", "change_description"},
        "addition": {"revision", "detailed_class"},
        "discontinuation": {"revision", "discontinued_project", "change_description"},
    }
    common_fields = {"material_no", "description", "material_class", "spare_part", "optional_part"}

    class Meta:
        model = MaterialChange
        fields = ["id", "category", "request_id", "material_no", "description", "material_class", "spare_part", "optional_part", "old_revision", "new_revision", "revision", "detailed_class", "discontinued_project", "change_description", "dispositions"]
        read_only_fields = ["id"]

    def to_internal_value(self, data):
        if not isinstance(data, dict):
            raise serializers.ValidationError({"detail": "请求内容必须是对象。"})
        category = self.instance.category if self.instance else data.get("category")
        if not isinstance(category, str) or category not in self.category_fields:
            raise serializers.ValidationError({"category": "请选择升版、新增或停用。"})
        allowed = self.common_fields | self.category_fields[category]
        if category != "addition":
            allowed = allowed | {"dispositions"}
        if self.instance is None:
            allowed = allowed | {"category", "request_id"}
        forbidden = set(data) - allowed
        if forbidden:
            raise serializers.ValidationError({key: "此字段不允许修改或不适用于该类别。" for key in forbidden})
        return super().to_internal_value(data)

    def validate_dispositions(self, values):
        if set(values) - set(LOCATIONS):
            raise serializers.ValidationError("处置位置不合法。")
        return values

    def to_representation(self, instance):
        result = super().to_representation(instance)
        result["dispositions"] = {row.location_item: {"disposition": row.disposition, "remark": row.remark} for row in instance.dispositions.all()}
        return result

    def save(self, **kwargs):
        positions = self.validated_data.pop("dispositions", {})
        with transaction.atomic():
            instance = super().save(**kwargs)
            for key, values in positions.items():
                existing = instance.dispositions.filter(location_item=key).first()
                disposition = values.get("disposition", existing.disposition if existing else "")
                remark = values.get("remark", existing.remark if existing else "")
                if not disposition and not remark:
                    if existing:
                        existing.delete()
                else:
                    MaterialDisposition.objects.update_or_create(material=instance, location_item=key, defaults={"location_group": LOCATIONS[key], "disposition": disposition, "remark": remark})
            return instance
