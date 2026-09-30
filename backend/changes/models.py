from django.conf import settings
from django.db import models


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
            models.CheckConstraint(
                condition=models.Q(status__in=["draft", "pending", "approved"]),
                name="change_request_valid_status",
            )
        ]
