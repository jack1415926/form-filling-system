from django.contrib.auth import get_user_model
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from threading import Barrier, Event

from django.db import IntegrityError, connection, connections, transaction
from django.test import TestCase, TransactionTestCase
from rest_framework.test import APIClient

from .models import ChangeRequest


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
        response = self.client.patch(f"/api/changes/{record.pk}/", {"title": "修改", "planned_eco_date": "2026-02-30"}, format="json")
        self.assertEqual(response.status_code, 400)
        record.refresh_from_db()
        self.assertEqual(record.title, "原内容")

    def test_csrf_required_for_login_logout_and_writes(self):
        anonymous = APIClient(enforce_csrf_checks=True)
        self.assertEqual(anonymous.post("/api/auth/login/", {"username": "applicant", "password": "test-password-2026"}, format="json").status_code, 403)
        self.client.credentials()
        self.assertEqual(self.client.post("/api/changes/", {}, format="json").status_code, 403)
        self.assertEqual(self.client.post("/api/auth/logout/").status_code, 403)

    def test_put_and_delete_not_available(self):
        record = ChangeRequest.objects.create(applicant=self.owner)
        self.assertEqual(self.client.put(f"/api/changes/{record.pk}/", {}, format="json").status_code, 405)
        self.assertEqual(self.client.delete(f"/api/changes/{record.pk}/").status_code, 405)

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

    def test_patch_requires_csrf(self):
        record = ChangeRequest.objects.create(applicant=self.owner, title="原内容")
        self.client.credentials()
        response = self.client.patch(f"/api/changes/{record.pk}/", {"title": "修改"}, format="json")
        self.assertEqual(response.status_code, 403)
        record.refresh_from_db()
        self.assertEqual(record.title, "原内容")

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
