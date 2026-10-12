from django.db import IntegrityError, transaction
from django.contrib.auth import get_user_model
from rest_framework import serializers

from .models import ChangeRequest, MaterialChange, MaterialDisposition, EcrActionResponse, EcoActionResponse
from .dispositions import LOCATIONS, DISPOSITIONS
from .questions import QUESTIONS
from .dates import BusinessDateField

NUMBER_ERRORS = {"ecr_no": "ECR 编号已存在，请使用其他编号。", "eco_no": "ECO 编号已存在，请使用其他编号。"}


class ChangeRequestSerializer(serializers.ModelSerializer):
    source_ecr_id = serializers.IntegerField(read_only=True, allow_null=True)
    published_by_id = serializers.IntegerField(read_only=True, allow_null=True)
    source_ecr_no = serializers.CharField(source='source_ecr.ecr_no', read_only=True, default=None)
    planned_eco_date = BusinessDateField(required=False, allow_null=True)
    publisher_id = serializers.IntegerField(required=False, allow_null=True, min_value=1)

    class Meta:
        model = ChangeRequest
        fields = [
            "id", "applicant", "stage", "publisher_id", "status", "created_at", "updated_at", "review_mode", "submitted_at", "current_review_round",
            "source_ecr_id", "source_ecr_no", "eco_creation_request_id", "published_by_id", "published_at", "publication_request_id",
            "title", "ecr_no", "eco_no", "affected_products", "affected_region",
            "initiating_factory", "affected_factories", "ccb_owner", "change_owner",
            "planned_eco_date", "change_reason",
        ]
        read_only_fields = ["id", "applicant", "stage", "status", "created_at", "updated_at", "review_mode", "submitted_at", "current_review_round", "source_ecr_id", "source_ecr_no", "eco_creation_request_id", "published_by_id", "published_at", "publication_request_id"]

    def validate_publisher_id(self, value):
        if self.instance is None or self.instance.stage not in ['ecr', 'eco']:
            raise serializers.ValidationError('仅新ECR／ECO可指定发布人。')
        if value is not None and not get_user_model().objects.filter(pk=value, is_active=True).exists():
            raise serializers.ValidationError('请选择有效发布人。')
        return value

    def validate(self, attrs):
        errors = {}
        if self.instance and self.instance.stage == 'ecr' and attrs.get('eco_no'):
            errors['eco_no'] = ['ECO阶段尚未启动，不能填写ECO编号。']
        if self.instance and self.instance.stage == 'eco' and attrs.get('ecr_no'):
            errors['ecr_no'] = ['来源ECR编号只读，ECO不能填写独立ECR编号。']
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
    date = BusinessDateField(required=False, allow_null=True)
    owner_user_id = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    owner_user = serializers.SerializerMethodField()

    class Meta:
        model = EcrActionResponse
        fields = ["owner", "owner_user_id", "owner_user", "extra_required", "result", "status", "date"]
        read_only_fields = ["owner", "owner_user"]

    def get_owner_user(self, instance):
        user = instance.owner_user
        return {"id": user.pk, "username": user.username, "display_name": user.get_full_name() or user.username, "is_active": user.is_active} if user else None

    def validate_owner_user_id(self, value):
        if value is None:
            return None
        user = get_user_model().objects.select_for_update().filter(pk=value).first()
        if user is None or not user.is_active and value != getattr(self.instance, 'owner_user_id', None):
            raise serializers.ValidationError('请选择有效用户；停用用户仅保留已有关联。')
        return value

    def to_internal_value(self, data):
        if not isinstance(data, dict):
            raise serializers.ValidationError({"detail": "请求内容必须是对象。"})
        if 'owner' in data:
            raise serializers.ValidationError({'owner': '原负责人文字只读，请刷新页面并选择负责人用户。'})
        if 'owner_user_id' in data and data['owner_user_id'] is not None and type(data['owner_user_id']) is not int:
            raise serializers.ValidationError({'owner_user_id': '负责人账号ID必须为整数或null。'})
        forbidden = set(data) - (set(self.Meta.fields) - set(self.Meta.read_only_fields))
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


class EcoActionSerializer(EcrActionSerializer):
    class Meta(EcrActionSerializer.Meta):
        model = EcoActionResponse
        fields = EcrActionSerializer.Meta.fields
