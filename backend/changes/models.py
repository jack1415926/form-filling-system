from django.conf import settings
from django.db import models
from django.db.models.functions import NullIf
from .dispositions import LOCATIONS, DISPOSITIONS


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
