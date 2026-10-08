from django.conf import settings
from django.db import models
from .execution_plan import PLAN_ACTIVITY_IDS
from django.db.models.functions import NullIf
from .dispositions import LOCATIONS, DISPOSITIONS
from .ecr import ECR_ACTION_IDS
from .eco import ECO_ACTION_IDS
from .significant_change import CHART_IDS, QUESTION_IDS, F_VALUES, FINAL_VALUES, RESULT_VALUES


class ChangeRequest(models.Model):
    class Status(models.TextChoices):
        DRAFT = "draft", "草稿"
        PENDING = "pending", "待审批"
        APPROVED = "approved", "已批准"
        RETURNED = "returned", "待修订"

    applicant = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.DRAFT)
    review_mode = models.CharField(max_length=16, blank=True, db_collation="utf8mb4_bin", choices=[("designated", "指定审核"), ("public", "公开审核")])
    submitted_at = models.DateTimeField(null=True, blank=True)
    current_review_round = models.PositiveIntegerField(default=0)
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
            models.CheckConstraint(condition=models.Q(review_mode__in=["", "designated", "public"]), name="change_valid_review_mode"),
            models.UniqueConstraint(fields=["ecr_no_unique"], name="change_request_ecr_no_unique"),
            models.UniqueConstraint(fields=["eco_no_unique"], name="change_request_eco_no_unique"),
            models.CheckConstraint(
                condition=models.Q(status__in=["draft", "pending", "approved", "returned"]),
                name="change_request_valid_status",
            )
        ]


class ReviewRound(models.Model):
    change = models.ForeignKey(ChangeRequest, on_delete=models.CASCADE, related_name="review_rounds")
    number = models.PositiveIntegerField()
    review_mode = models.CharField(max_length=16, db_collation="utf8mb4_bin")
    request_id = models.UUIDField(null=True, blank=True)
    title = models.CharField(max_length=255)
    ecr_no = models.CharField(max_length=64)
    eco_no = models.CharField(max_length=64, blank=True)
    submitted_at = models.DateTimeField()
    state = models.CharField(max_length=16, default="pending", db_collation="utf8mb4_bin")
    approved_at = models.DateTimeField(null=True, blank=True)
    returned_at = models.DateTimeField(null=True, blank=True)
    returned_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT)
    return_reason = models.TextField(blank=True)

    class Meta:
        db_table = "review_round"
        constraints = [
            models.UniqueConstraint(fields=["change", "number"], name="review_unique_round"),
            models.UniqueConstraint(fields=["change", "request_id"], name="review_unique_submission"),
            models.CheckConstraint(condition=models.Q(number__gt=0), name="review_round_positive"),
            models.CheckConstraint(condition=models.Q(review_mode__in=["designated", "public"]), name="review_round_mode"),
            models.CheckConstraint(condition=models.Q(state__in=["pending", "approved", "returned"]), name="review_round_state"),
        ]


class ReviewRecord(models.Model):
    change = models.ForeignKey(ChangeRequest, on_delete=models.CASCADE, related_name="review_records")
    round = models.ForeignKey(ReviewRound, null=True, blank=True, on_delete=models.CASCADE, related_name="records")
    reviewer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    assigned = models.BooleanField(default=True)
    approved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "review_record"
        constraints = [models.UniqueConstraint(fields=["round", "reviewer"], name="review_unique_person")]


class ReviewFeedback(models.Model):
    round = models.ForeignKey(ReviewRound, on_delete=models.CASCADE, related_name="feedback")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    request_id = models.UUIDField()
    text = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "review_feedback"
        constraints = [models.UniqueConstraint(fields=["round", "author", "request_id"], name="review_unique_feedback")]


class ReviewInboxRead(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    round = models.ForeignKey(ReviewRound, on_delete=models.CASCADE)
    signature = models.CharField(max_length=64)
    read_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'review_inbox_read'
        constraints = [models.UniqueConstraint(fields=['user', 'round'], name='inbox_read_user_round')]


class ReviewIssue(models.Model):
    change = models.ForeignKey(ChangeRequest, on_delete=models.CASCADE, related_name="review_issues")
    source_round = models.ForeignKey(ReviewRound, on_delete=models.CASCADE)
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    tab = models.CharField(max_length=32)
    location = models.CharField(max_length=255, blank=True)
    text = models.TextField()
    state = models.CharField(max_length=16, default="awaiting_reply", db_collation="utf8mb4_bin")
    version = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "review_issue"
        constraints = [
            models.CheckConstraint(condition=models.Q(state__in=["awaiting_reply", "awaiting_review", "resolved"]), name="review_issue_state"),
            models.CheckConstraint(condition=models.Q(version__gt=0), name="review_issue_version"),
        ]


class ReviewIssueEvent(models.Model):
    change = models.ForeignKey(ChangeRequest, on_delete=models.CASCADE, related_name="issue_events")
    round = models.ForeignKey(ReviewRound, on_delete=models.CASCADE)
    issue = models.ForeignKey(ReviewIssue, null=True, on_delete=models.CASCADE, related_name="events")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    kind = models.CharField(max_length=16)
    text = models.TextField(blank=True)
    state = models.CharField(max_length=16, blank=True)
    version = models.PositiveIntegerField(default=0)
    request_id = models.UUIDField()
    position = models.PositiveIntegerField(default=0)
    payload = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "review_issue_event"
        constraints = [models.UniqueConstraint(fields=["change", "author", "request_id", "position"], name="review_issue_request")]


class SystemFeedback(models.Model):
    submitter = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    category = models.CharField(max_length=16, db_collation='utf8mb4_bin', choices=[('problem', '问题'), ('suggestion', '建议'), ('other', '其他')])
    content = models.TextField()
    status = models.CharField(max_length=16, default='pending', db_collation='utf8mb4_bin')
    request_id = models.UUIDField()
    version = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'system_feedback'
        constraints = [
            models.UniqueConstraint(fields=['submitter', 'request_id'], name='sys_feedback_request'),
            models.CheckConstraint(condition=models.Q(category__in=['problem', 'suggestion', 'other']), name='sys_feedback_category'),
            models.CheckConstraint(condition=models.Q(status__in=['pending', 'processing', 'closed']), name='sys_feedback_status'),
        ]


class SystemFeedbackEvent(models.Model):
    feedback = models.ForeignKey(SystemFeedback, on_delete=models.CASCADE, related_name='events')
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    text = models.TextField(blank=True)
    from_status = models.CharField(max_length=16, db_collation='utf8mb4_bin')
    to_status = models.CharField(max_length=16, db_collation='utf8mb4_bin')
    request_id = models.UUIDField()
    base_version = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'system_feedback_event'
        constraints = [
            models.UniqueConstraint(fields=['feedback', 'request_id'], name='sys_feedback_event_request'),
            models.CheckConstraint(condition=models.Q(from_status__in=['pending', 'processing', 'closed']), name='sys_feedback_event_from'),
            models.CheckConstraint(condition=models.Q(to_status__in=['pending', 'processing', 'closed']), name='sys_feedback_event_to'),
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


class ExecutionPlanResponse(models.Model):
    change = models.ForeignKey(ChangeRequest, on_delete=models.CASCADE, related_name="execution_plan_responses")
    activity_key = models.CharField(max_length=8, db_collation="utf8mb4_bin")
    owner = models.CharField(max_length=255, blank=True)
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    remark = models.TextField(blank=True)

    class Meta:
        db_table = "execution_plan_response"
        constraints = [
            models.UniqueConstraint(fields=["change", "activity_key"], name="plan_unique_activity"),
            models.CheckConstraint(condition=models.Q(activity_key__in=PLAN_ACTIVITY_IDS), name="plan_valid_activity"),
            models.CheckConstraint(condition=models.Q(start_date__isnull=True) | models.Q(end_date__isnull=True) | models.Q(end_date__gte=models.F("start_date")), name="plan_date_order"),
        ]


class SignificantAssessment(models.Model):
    change = models.OneToOneField(ChangeRequest, on_delete=models.CASCADE, related_name="significant_assessment")
    f_assessment = models.CharField(max_length=24, blank=True, db_collation="utf8mb4_bin")
    final_conclusion = models.CharField(max_length=16, blank=True, db_collation="utf8mb4_bin")

    class Meta:
        db_table = "significant_assessment"
        constraints = [
            models.CheckConstraint(condition=models.Q(f_assessment__in=F_VALUES), name="sig_valid_f"),
            models.CheckConstraint(condition=models.Q(final_conclusion__in=FINAL_VALUES), name="sig_valid_final"),
        ]


class SignificantChartResponse(models.Model):
    change = models.ForeignKey(ChangeRequest, on_delete=models.CASCADE, related_name="significant_charts")
    chart_key = models.CharField(max_length=1, db_collation="utf8mb4_bin")
    applicability = models.CharField(max_length=1, blank=True, db_collation="utf8mb4_bin")
    reason = models.TextField(blank=True)
    result = models.CharField(max_length=16, blank=True, db_collation="utf8mb4_bin")

    class Meta:
        db_table = "significant_chart_response"
        constraints = [
            models.UniqueConstraint(fields=["change", "chart_key"], name="sig_unique_chart"),
            models.CheckConstraint(condition=models.Q(chart_key__in=CHART_IDS), name="sig_valid_chart"),
            models.CheckConstraint(condition=models.Q(applicability__in=["", "Y", "N"]), name="sig_valid_applicability"),
            models.CheckConstraint(condition=models.Q(result__in=RESULT_VALUES), name="sig_valid_result"),
            models.CheckConstraint(condition=(
                models.Q(chart_key="0", result="")
                | models.Q(chart_key__in=["A", "B", "C", "D"], result__in=["", "not_applicable", "significant", "continue"])
                | models.Q(chart_key="E", result__in=["", "not_applicable", "significant", "non_significant"])
            ), name="sig_result_for_chart"),
        ]


class SignificantQuestionResponse(models.Model):
    change = models.ForeignKey(ChangeRequest, on_delete=models.CASCADE, related_name="significant_questions")
    question_key = models.CharField(max_length=16, db_collation="utf8mb4_bin")
    answer = models.CharField(max_length=1, blank=True, db_collation="utf8mb4_bin")
    reason = models.TextField(blank=True)

    class Meta:
        db_table = "significant_question_response"
        constraints = [
            models.UniqueConstraint(fields=["change", "question_key"], name="sig_unique_question"),
            models.CheckConstraint(condition=models.Q(question_key__in=QUESTION_IDS), name="sig_valid_question"),
            models.CheckConstraint(condition=models.Q(answer__in=["", "Y", "N"]), name="sig_valid_answer"),
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
