from django.contrib.auth import get_user_model
from django.contrib.sessions.models import Session
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from threading import Barrier, Event
from unittest.mock import patch

from django.db import IntegrityError, connection, connections, transaction
from django.test import TestCase, TransactionTestCase, override_settings
from rest_framework.test import APIClient

from .models import ChangeRequest
from .serializers import ChangeRequestSerializer


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class DraftFlowTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = get_user_model().objects.create_user("applicant", password="test-password-2026")
        cls.other = get_user_model().objects.create_user("other", password="test-password-2026")

    def setUp(self):
        self.client = APIClient(enforce_csrf_checks=True)
        self.login()

    def login(self, username="applicant"):
        token = self.client.get("/api/auth/csrf/").json()["csrfToken"]
        response = self.client.post("/api/auth/login/", {"username": username, "password": "test-password-2026"}, format="json", HTTP_X_CSRFTOKEN=token)
        self.assertEqual(response.status_code, 200)
        self.client.credentials(HTTP_X_CSRFTOKEN=response.json()["csrfToken"])

    def test_mysql_and_draft_recovery_after_relogin(self):
        self.assertEqual(connection.vendor, "mysql")
        fields = {"title": "去除部分物料号", "ecr_no": "ECR-26010601", "affected_products": "型号一、型号二", "affected_region": "中国大陆", "initiating_factory": "南京工厂", "affected_factories": "南京工厂", "ccb_owner": "负责人甲", "change_owner": "负责人乙", "planned_eco_date": "2026-01-30", "change_reason": "市场需求\n删除不需要的物料号"}
        created = self.client.post("/api/changes/", fields, format="json")
        self.assertEqual(created.status_code, 201)
        pk = created.json()["id"]
        self.assertEqual(created.json()["status"], "draft")
        self.assertEqual(created.json()["applicant"], self.owner.pk)
        self.assertEqual(self.client.post("/api/auth/logout/").status_code, 200)
        self.login()
        restored = self.client.get(f"/api/changes/{pk}/").json()
        for key, value in fields.items():
            self.assertEqual(restored[key], value)
        changed = self.client.patch(f"/api/changes/{pk}/", {"title": "修改后的标题", "planned_eco_date": None}, format="json")
        self.assertEqual(changed.status_code, 200)
        self.assertEqual(changed.json()["change_reason"], fields["change_reason"])
        self.assertIsNone(changed.json()["planned_eco_date"])

    def test_empty_draft_is_allowed(self):
        response = self.client.post("/api/changes/", {}, format="json")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["title"], "")

    def test_nonempty_numbers_are_unique_across_users_on_create_and_patch(self):
        existing = ChangeRequest.objects.create(applicant=self.other, ecr_no="ECR-UNIQUE", eco_no="ECO-UNIQUE", title="另一人的申请")
        candidate = ChangeRequest.objects.create(applicant=self.owner, title="原内容")
        for field in ("ecr_no", "eco_no"):
            with self.subTest(field=field):
                value = getattr(existing, field)
                created = self.client.post("/api/changes/", {field: value}, format="json")
                self.assertEqual(created.status_code, 400)
                self.assertEqual(set(created.json()), {field})
                updated = self.client.patch(f"/api/changes/{candidate.pk}/", {field: value, "title": "不应保存"}, format="json")
                self.assertEqual(updated.status_code, 400)
                self.assertEqual(set(updated.json()), {field})
                self.assertNotIn(existing.title, str(updated.json()))
                candidate.refresh_from_db()
                self.assertEqual(candidate.title, "原内容")
                self.assertEqual(getattr(candidate, field), "")

    def test_empty_numbers_original_number_clear_and_reuse(self):
        for _ in range(3):
            response = self.client.post("/api/changes/", {"ecr_no": "", "eco_no": ""}, format="json")
            self.assertEqual(response.status_code, 201)
            self.assertEqual(response.json()["ecr_no"], "")
            self.assertEqual(response.json()["eco_no"], "")
        record = ChangeRequest.objects.create(applicant=self.owner, ecr_no="000001", eco_no="ECO-ONE")
        same = self.client.patch(f"/api/changes/{record.pk}/", {"ecr_no": " 000001 ", "eco_no": "ECO-ONE", "title": "新标题"}, format="json")
        self.assertEqual(same.status_code, 200)
        self.assertEqual(same.json()["ecr_no"], "000001")
        cleared = self.client.patch(f"/api/changes/{record.pk}/", {"ecr_no": "", "eco_no": ""}, format="json")
        self.assertEqual(cleared.status_code, 200)
        self.assertEqual(cleared.json()["ecr_no"], "")
        reused = self.client.post("/api/changes/", {"ecr_no": "000001", "eco_no": "ECO-ONE"}, format="json")
        self.assertEqual(reused.status_code, 201)

    def test_number_types_are_independently_unique_and_internal_fields_are_hidden(self):
        first = self.client.post("/api/changes/", {"ecr_no": "SHARED-TEXT"}, format="json")
        second = self.client.post("/api/changes/", {"eco_no": "SHARED-TEXT"}, format="json")
        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 201)
        for response in (first, second):
            self.assertNotIn("ecr_no_unique", response.json())
            self.assertNotIn("eco_no_unique", response.json())
        for field in ("ecr_no_unique", "eco_no_unique"):
            rejected = self.client.post("/api/changes/", {field: "forged"}, format="json")
            self.assertEqual(rejected.status_code, 400)

    def test_database_enforces_number_uniqueness_and_empty_values(self):
        existing = ChangeRequest.objects.create(applicant=self.owner, ecr_no="DB-ECR", eco_no="DB-ECO")
        blank = ChangeRequest.objects.create(applicant=self.owner)
        another_blank = ChangeRequest.objects.create(applicant=self.owner)
        self.assertIsNone(blank.ecr_no_unique)
        self.assertIsNone(another_blank.eco_no_unique)
        for field in ("ecr_no", "eco_no"):
            with self.subTest(field=field), self.assertRaises(IntegrityError), transaction.atomic():
                ChangeRequest.objects.filter(pk=blank.pk).update(**{field: getattr(existing, field), "title": "不应保存"})
        blank.refresh_from_db()
        self.assertEqual(blank.title, "")
        self.assertEqual(blank.ecr_no, "")
        self.assertEqual(blank.eco_no, "")

    def test_unrelated_integrity_errors_are_not_reported_as_number_conflicts(self):
        serializer = ChangeRequestSerializer(data={})
        self.assertTrue(serializer.is_valid())
        for error in (IntegrityError(1062, "Duplicate entry 'change_request_ecr_no_unique' for key 'unrelated_key'"), IntegrityError(1048, "Column cannot be null")):
            with self.subTest(error=error), patch.object(ChangeRequest.objects, "create", side_effect=error), self.assertRaises(IntegrityError):
                serializer.save(applicant=self.owner)

    def test_other_user_cannot_see_or_update_draft(self):
        record = ChangeRequest.objects.create(applicant=self.owner, title="私有草稿")
        self.login("other")
        self.assertEqual(self.client.get("/api/changes/").json(), [])
        self.assertEqual(self.client.get(f"/api/changes/{record.pk}/").status_code, 404)
        self.assertEqual(self.client.patch(f"/api/changes/{record.pk}/", {"title": "篡改"}, format="json").status_code, 404)

    def test_unauthenticated_access_is_denied(self):
        client = APIClient()
        self.assertEqual(client.get("/api/auth/me/").status_code, 401)
        self.assertEqual(client.get("/api/changes/").status_code, 403)
        self.assertEqual(client.post("/api/changes/", {}, format="json").status_code, 403)

    def test_server_fields_cannot_be_forged(self):
        for key, value in {"applicant": self.other.pk, "status": "approved", "id": 999, "created_at": "2026-01-01"}.items():
            with self.subTest(key=key):
                self.assertEqual(self.client.post("/api/changes/", {key: value}, format="json").status_code, 400)
        record = ChangeRequest.objects.create(applicant=self.owner)
        self.assertEqual(self.client.patch(f"/api/changes/{record.pk}/", {"status": "approved"}, format="json").status_code, 400)
        record.refresh_from_db()
        self.assertEqual(record.status, "draft")

    def test_locked_record_cannot_be_saved(self):
        for state in ["pending", "approved"]:
            record = ChangeRequest.objects.create(applicant=self.owner, status=state, title="原内容")
            self.assertEqual(self.client.patch(f"/api/changes/{record.pk}/", {"title": "修改"}, format="json").status_code, 409)
            record.refresh_from_db()
            self.assertEqual(record.title, "原内容")

    def test_invalid_date_does_not_partially_save(self):
        record = ChangeRequest.objects.create(applicant=self.owner, title="原内容")
        for date in ["2026-02-30", "10000-02-04"]:
            with self.subTest(date=date):
                response = self.client.patch(f"/api/changes/{record.pk}/", {"title": "修改", "planned_eco_date": date}, format="json")
                self.assertEqual(response.status_code, 400)
                record.refresh_from_db()
                self.assertEqual(record.title, "原内容")

    def test_csrf_required_for_login_logout_and_writes(self):
        anonymous = APIClient(enforce_csrf_checks=True)
        self.assertEqual(anonymous.post("/api/auth/login/", {"username": "applicant", "password": "test-password-2026"}, format="json").status_code, 403)
        self.client.credentials()
        self.assertEqual(self.client.post("/api/changes/", {}, format="json").status_code, 403)
        record = ChangeRequest.objects.create(applicant=self.owner, title="原内容")
        response = self.client.patch(f"/api/changes/{record.pk}/", {"title": "修改"}, format="json")
        self.assertEqual(response.status_code, 403)
        record.refresh_from_db()
        self.assertEqual(record.title, "原内容")
        self.assertEqual(self.client.post("/api/auth/logout/").status_code, 403)

    def test_bad_login_and_invalid_payload(self):
        client = APIClient(enforce_csrf_checks=True)
        token = client.get("/api/auth/csrf/").json()["csrfToken"]
        for payload in [{"username": "applicant", "password": "wrong"}, []]:
            self.assertEqual(client.post("/api/auth/login/", payload, format="json", HTTP_X_CSRFTOKEN=token).status_code, 400)

    def test_inactive_user_loses_access_and_cannot_login(self):
        self.owner.is_active = False
        self.owner.save(update_fields=["is_active"])
        self.assertEqual(self.client.get("/api/auth/me/").status_code, 401)
        self.assertEqual(self.client.get("/api/changes/").status_code, 403)
        token = self.client.get("/api/auth/csrf/").json()["csrfToken"]
        response = self.client.post("/api/auth/login/", {"username": "applicant", "password": "test-password-2026"}, format="json", HTTP_X_CSRFTOKEN=token)
        self.assertEqual(response.status_code, 400)

    def test_invalid_payload_and_utf8_boundaries(self):
        for payload in [[], {"title": None}, {"title": "字" * 256}, {"ecr_no": "0" * 65}, {"unknown_field": "value"}]:
            with self.subTest(payload=payload):
                self.assertEqual(self.client.post("/api/changes/", payload, format="json").status_code, 400)
        response = self.client.post("/api/changes/", {"title": "字" * 255, "ecr_no": "000001", "change_reason": "中文与 supplementary Unicode：🧪"}, format="json")
        self.assertEqual(response.status_code, 201)
        restored = self.client.get(f"/api/changes/{response.json()['id']}/").json()
        self.assertEqual(restored["ecr_no"], "000001")
        self.assertIn("🧪", restored["change_reason"])

    def test_database_rejects_unknown_status(self):
        record = ChangeRequest.objects.create(applicant=self.owner)
        with self.assertRaises(IntegrityError), transaction.atomic():
            ChangeRequest.objects.filter(pk=record.pk).update(status="unexpected")
        record.refresh_from_db()
        self.assertEqual(record.status, "draft")

    def test_new_login_invalidates_previous_session(self):
        previous_key = self.client.cookies["sessionid"].value
        new_client = APIClient(enforce_csrf_checks=True)
        token = new_client.get("/api/auth/csrf/").json()["csrfToken"]
        response = new_client.post("/api/auth/login/", {"username": "applicant", "password": "test-password-2026"}, format="json", HTTP_X_CSRFTOKEN=token)
        self.assertEqual(response.status_code, 200)
        self.assertFalse(Session.objects.filter(session_key=previous_key).exists())
        self.assertEqual(self.client.get("/api/auth/me/").status_code, 401)
        self.assertEqual(self.client.get("/api/changes/").status_code, 403)
        self.assertEqual(new_client.get("/api/auth/me/").status_code, 200)

    def test_same_browser_relogin_rotates_session_without_breaking_writes(self):
        previous_key = self.client.cookies["sessionid"].value
        self.login()
        self.assertNotEqual(self.client.cookies["sessionid"].value, previous_key)
        self.assertFalse(Session.objects.filter(session_key=previous_key).exists())
        self.assertEqual(self.client.post("/api/changes/", {}, format="json").status_code, 201)

    def test_builtin_login_obeys_single_session_rule_and_other_users_keep_access(self):
        previous_key = self.client.cookies["sessionid"].value
        other_client = APIClient()
        self.assertTrue(other_client.login(username="other", password="test-password-2026"))
        # Django's built-in login is also used by its admin site.
        builtin_client = APIClient()
        self.assertTrue(builtin_client.login(username="applicant", password="test-password-2026"))
        self.assertFalse(Session.objects.filter(session_key=previous_key).exists())
        self.assertEqual(self.client.get("/api/auth/me/").status_code, 401)
        self.assertEqual(builtin_client.get("/api/auth/me/").status_code, 200)
        self.assertEqual(other_client.get("/api/auth/me/").status_code, 200)


class ConcurrentDraftTests(TransactionTestCase):
    def setUp(self):
        self.owner = get_user_model().objects.create_user("concurrent-applicant")

    def patch_from_connection(self, pk, values, barrier=None, started=None):
        try:
            client = APIClient()
            client.force_authenticate(user=self.owner)
            if barrier:
                barrier.wait(timeout=10)

            def mark_select(execute, sql, params, many, context):
                if started and sql.lstrip().upper().startswith("SELECT") and "change_request" in sql:
                    started.set()
                return execute(sql, params, many, context)

            with connection.execute_wrapper(mark_select):
                response = client.patch(f"/api/changes/{pk}/", values, format="json")
            return response.status_code
        finally:
            connections.close_all()

    def create_from_connection(self, values):
        try:
            client = APIClient()
            client.force_authenticate(user=self.owner)
            response = client.post("/api/changes/", values, format="json")
            return response.status_code, response.json()
        finally:
            connections.close_all()

    def test_concurrent_creates_with_same_number_return_field_error(self):
        original_validate = ChangeRequestSerializer.validate
        for field in ("ecr_no", "eco_no"):
            barrier = Barrier(2)
            def validate_together(serializer, attrs):
                validated = original_validate(serializer, attrs)
                barrier.wait(timeout=10)
                return validated
            with self.subTest(field=field), patch.object(ChangeRequestSerializer, "validate", validate_together), ThreadPoolExecutor(max_workers=2) as executor:
                futures = [executor.submit(self.create_from_connection, {field: "RACE-CREATE"}) for _ in range(2)]
                responses = [future.result(timeout=15) for future in futures]
            self.assertEqual(sorted(code for code, _ in responses), [201, 400])
            self.assertEqual(set(next(data for code, data in responses if code == 400)), {field})
            self.assertEqual(ChangeRequest.objects.filter(**{field: "RACE-CREATE"}).count(), 1)

    def test_concurrent_patches_with_same_number_roll_back_loser(self):
        original_validate = ChangeRequestSerializer.validate
        for field in ("ecr_no", "eco_no"):
            records = [ChangeRequest.objects.create(applicant=self.owner, title=f"原内容{index}") for index in range(2)]
            barrier = Barrier(2)
            def validate_together(serializer, attrs):
                validated = original_validate(serializer, attrs)
                barrier.wait(timeout=10)
                return validated
            with self.subTest(field=field), patch.object(ChangeRequestSerializer, "validate", validate_together), ThreadPoolExecutor(max_workers=2) as executor:
                futures = [executor.submit(self.patch_from_connection, record.pk, {field: "RACE-PATCH", "title": "成功内容"}) for record in records]
                codes = [future.result(timeout=15) for future in futures]
            self.assertEqual(sorted(codes), [200, 400])
            for index, record in enumerate(records):
                record.refresh_from_db()
                if codes[index] == 400:
                    self.assertEqual(record.title, f"原内容{index}")
                    self.assertEqual(getattr(record, field), "")
            self.assertEqual(ChangeRequest.objects.filter(**{field: "RACE-PATCH"}).count(), 1)

    def test_parallel_partial_saves_keep_both_updates(self):
        self.assertEqual(connection.vendor, "mysql")
        for iteration in range(5):
            record = ChangeRequest.objects.create(applicant=self.owner, title="原标题", affected_region="原区域")
            barrier = Barrier(2)
            with ThreadPoolExecutor(max_workers=2) as executor:
                first = executor.submit(self.patch_from_connection, record.pk, {"title": f"标题{iteration}"}, barrier)
                second = executor.submit(self.patch_from_connection, record.pk, {"affected_region": f"区域{iteration}"}, barrier)
                self.assertEqual(first.result(timeout=15), 200)
                self.assertEqual(second.result(timeout=15), 200)
            record.refresh_from_db()
            self.assertEqual(record.title, f"标题{iteration}")
            self.assertEqual(record.affected_region, f"区域{iteration}")

    def test_save_waits_for_existing_record_lock(self):
        record = ChangeRequest.objects.create(applicant=self.owner, title="原标题")
        started = Event()
        with ThreadPoolExecutor(max_workers=1) as executor:
            with transaction.atomic():
                locked = ChangeRequest.objects.select_for_update().get(pk=record.pk)
                future = executor.submit(self.patch_from_connection, record.pk, {"affected_region": "新区域"}, None, started)
                self.assertTrue(started.wait(timeout=10))
                with self.assertRaises(TimeoutError):
                    future.result(timeout=0.15)
                locked.title = "持锁期间的新标题"
                locked.save(update_fields=["title"])
            self.assertEqual(future.result(timeout=15), 200)
        record.refresh_from_db()
        self.assertEqual(record.title, "持锁期间的新标题")
        self.assertEqual(record.affected_region, "新区域")
