from django.contrib.auth import get_user_model
from django.db import connection
from django.test import TestCase
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
