from django.conf import settings
from django.db import models
from django.db.models.functions import NullIf
from .dispositions import LOCATIONS, DISPOSITIONS
from .ecr import ECR_ACTION_IDS
from .eco import ECO_ACTION_IDS


class ChangeRequest(models.Model):
    class Status(models.TextChoices):
        DRAFT = "draft", "草稿"
        PENDING = "pending", "待审批"
        APPROVED = "approved", "已批准"

    applicant = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.DRAFT)
    title = models.CharField(max_length=255, blank=True)
    ecr_no = models.CharField(max_length=64, blank=True)
    eco_no = models.CharField(max_length=64, blank=True)
    ecr_no_unique = models.GeneratedField(
        expression=NullIf(models.F("ecr_no"), models.Value("")),
        output_field=models.CharField(max_length=64),
        db_persist=True,
    )
    eco_no_unique = models.GeneratedField(
        expression=NullIf(models.F("eco_no"), models.Value("")),
        output_field=models.CharField(max_length=64),
        db_persist=True,
    )
    affected_products = models.TextField(blank=True)
    affected_region = models.CharField(max_length=255, blank=True)
    initiating_factory = models.CharField(max_length=255, blank=True)
    affected_factories = models.TextField(blank=True)
    ccb_owner = models.CharField(max_length=255, blank=True)
    change_owner = models.CharField(max_length=255, blank=True)
    planned_eco_date = models.DateField(null=True, blank=True)
    change_reason = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "change_request"
        ordering = ["-updated_at", "-id"]
        constraints = [
            models.UniqueConstraint(fields=["ecr_no_unique"], name="change_request_ecr_no_unique"),
            models.UniqueConstraint(fields=["eco_no_unique"], name="change_request_eco_no_unique"),
            models.CheckConstraint(
                condition=models.Q(status__in=["draft", "pending", "approved"]),
                name="change_request_valid_status",
            )
        ]


class MaterialChange(models.Model):
    class Category(models.TextChoices):
        REVISION = "revision", "升版"
        ADDITION = "addition", "新增"
        DISCONTINUATION = "discontinuation", "停用"

    change = models.ForeignKey(ChangeRequest, on_delete=models.CASCADE, related_name="materials")
    category = models.CharField(max_length=20, choices=Category.choices)
    request_id = models.UUIDField(null=True, editable=False)
    material_no = models.CharField(max_length=255, blank=True)
    description = models.TextField(blank=True)
    material_class = models.CharField(max_length=255, blank=True)
    spare_part = models.CharField(max_length=1, blank=True, choices=[("Y", "Y"), ("N", "N")])
    optional_part = models.CharField(max_length=1, blank=True, choices=[("Y", "Y"), ("N", "N")])
    old_revision = models.CharField(max_length=255, blank=True)
    new_revision = models.CharField(max_length=255, blank=True)
    revision = models.CharField(max_length=255, blank=True)
    detailed_class = models.CharField(max_length=255, blank=True)
    discontinued_project = models.CharField(max_length=255, blank=True)
    change_description = models.TextField(blank=True)

    class Meta:
        db_table = "material_change"
        ordering = ["id"]
        constraints = [
            models.UniqueConstraint(fields=["change", "request_id"], name="material_unique_request"),
            models.CheckConstraint(condition=models.Q(category__in=["revision", "addition", "discontinuation"]), name="material_valid_category"),
            models.CheckConstraint(condition=models.Q(spare_part__in=["", "Y", "N"]), name="material_valid_spare_part"),
            models.CheckConstraint(condition=models.Q(optional_part__in=["", "Y", "N"]), name="material_valid_optional_part"),
        ]


class MaterialDisposition(models.Model):
    material = models.ForeignKey(MaterialChange, on_delete=models.CASCADE, related_name="dispositions")
    location_group = models.CharField(max_length=16)
    location_item = models.CharField(max_length=32)
    disposition = models.CharField(max_length=20, blank=True, choices=[(value, value) for value in DISPOSITIONS])
    remark = models.TextField(blank=True)

    class Meta:
        db_table = "material_disposition"
        ordering = ["location_item"]
        constraints = [
            models.UniqueConstraint(fields=["material", "location_item"], name="disposition_unique_location"),
            models.CheckConstraint(condition=models.Q(disposition__in=DISPOSITIONS), name="disposition_valid_value"),
            models.CheckConstraint(condition=(
                models.Q(location_group="company", location_item__in=[key for key, group in LOCATIONS.items() if group == "company"])
                | models.Q(location_group="supplier", location_item__in=[key for key, group in LOCATIONS.items() if group == "supplier"])
                | models.Q(location_group="customer", location_item__in=[key for key, group in LOCATIONS.items() if group == "customer"])
            ), name="disposition_valid_location"),
        ]


class QuestionResponse(models.Model):
    change = models.ForeignKey(ChangeRequest, on_delete=models.CASCADE, related_name="question_responses")
    number = models.PositiveSmallIntegerField()
    answer = models.CharField(max_length=1, blank=True, choices=[("Y", "是"), ("N", "否")])
    remark = models.TextField(blank=True)

    class Meta:
        db_table = "question_response"
        ordering = ["number"]
        constraints = [
            models.UniqueConstraint(fields=["change", "number"], name="question_unique_number"),
            models.CheckConstraint(condition=models.Q(number__gte=1, number__lte=27), name="question_valid_number"),
            models.CheckConstraint(condition=models.Q(answer__in=["", "Y", "N"]), name="question_valid_answer"),
        ]


class EcrActionResponse(models.Model):
    change = models.ForeignKey(ChangeRequest, on_delete=models.CASCADE, related_name="ecr_responses")
    action_key = models.CharField(max_length=7)
    owner = models.CharField(max_length=255, blank=True)
    result = models.TextField(blank=True)
    status = models.CharField(max_length=16, blank=True, choices=[("completed", "完成"), ("not_applicable", "不适用")])
    date = models.DateField(null=True, blank=True)

    class Meta:
        db_table = "ecr_action_response"
        constraints = [
            models.UniqueConstraint(fields=["change", "action_key"], name="ecr_unique_action"),
            models.CheckConstraint(condition=models.Q(action_key__in=ECR_ACTION_IDS), name="ecr_valid_action"),
            models.CheckConstraint(condition=models.Q(status__in=["", "completed", "not_applicable"]), name="ecr_valid_status"),
        ]


class EcoActionResponse(models.Model):
    change = models.ForeignKey(ChangeRequest, on_delete=models.CASCADE, related_name="eco_responses")
    action_key = models.CharField(max_length=7)
    owner = models.CharField(max_length=255, blank=True)
    result = models.TextField(blank=True)
    status = models.CharField(max_length=24, blank=True, choices=[("completed", "完成"), ("not_applicable", "不适用"), ("implementation_stage", "在实施阶段完成")])
    date = models.DateField(null=True, blank=True)

    class Meta:
        db_table = "eco_action_response"
        constraints = [
            models.UniqueConstraint(fields=["change", "action_key"], name="eco_unique_action"),
            models.CheckConstraint(condition=models.Q(action_key__in=ECO_ACTION_IDS), name="eco_valid_action"),
            models.CheckConstraint(condition=models.Q(status__in=["", "completed", "not_applicable", "implementation_stage"]), name="eco_valid_status"),
        ]


class EmcReference(models.Model):
    change = models.OneToOneField(ChangeRequest, on_delete=models.CASCADE, related_name="emc_reference")
    title = models.CharField(max_length=255, blank=True)
    introduction = models.TextField(blank=True)
    legend = models.TextField(blank=True)
    definitions = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "emc_reference"


class EmcReferenceRow(models.Model):
    reference = models.ForeignKey(EmcReference, on_delete=models.CASCADE, related_name="rows")
    key = models.CharField(max_length=64, db_collation="utf8mb4_bin")
    label = models.TextField(blank=True)
    sort_order = models.PositiveIntegerField()

    class Meta:
        db_table = "emc_reference_row"
        ordering = ["sort_order", "id"]
        constraints = [
            models.UniqueConstraint(fields=["reference", "key"], name="emc_row_unique_key"),
            models.UniqueConstraint(fields=["reference", "id"], name="emc_row_owner"),
            models.CheckConstraint(condition=models.Q(sort_order__gt=0), name="emc_row_valid_order"),
        ]


class EmcReferenceTest(models.Model):
    reference = models.ForeignKey(EmcReference, on_delete=models.CASCADE, related_name="tests")
    key = models.CharField(max_length=64, db_collation="utf8mb4_bin")
    label = models.TextField(blank=True)
    group_label = models.CharField(max_length=255, blank=True)
    standard_reference = models.CharField(max_length=255, blank=True)
    sort_order = models.PositiveIntegerField()

    class Meta:
        db_table = "emc_reference_test"
        ordering = ["sort_order", "id"]
        constraints = [
            models.UniqueConstraint(fields=["reference", "key"], name="emc_test_unique_key"),
            models.UniqueConstraint(fields=["reference", "id"], name="emc_test_owner"),
            models.CheckConstraint(condition=models.Q(sort_order__gt=0), name="emc_test_valid_order"),
        ]


class EmcReferenceCell(models.Model):
    reference = models.ForeignKey(EmcReference, on_delete=models.CASCADE, related_name="cells")
    row = models.ForeignKey(EmcReferenceRow, on_delete=models.CASCADE)
    test = models.ForeignKey(EmcReferenceTest, on_delete=models.CASCADE)
    mark = models.CharField(max_length=3, blank=True, db_collation="utf8mb4_bin", choices=[("X", "需要测试"), ("(X)", "需要分析")])
    remark = models.TextField(blank=True)

    class Meta:
        db_table = "emc_reference_cell"
        constraints = [
            models.UniqueConstraint(fields=["row", "test"], name="emc_unique_cell"),
            models.CheckConstraint(condition=models.Q(mark__in=["", "X", "(X)"]), name="emc_valid_mark"),
        ]
