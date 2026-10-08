from concurrent.futures import ThreadPoolExecutor, TimeoutError
from threading import Barrier, Event
from uuid import uuid4
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import IntegrityError, connection, connections, transaction
from django.test import TestCase, TransactionTestCase, override_settings
from rest_framework.test import APIClient

from .models import ChangeRequest, MaterialChange, MaterialDisposition


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class MaterialFlowTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = get_user_model().objects.create_user('material-owner', password='test-password')
        cls.other = get_user_model().objects.create_user('material-other')

    def setUp(self):
        self.record = ChangeRequest.objects.create(applicant=self.owner, title='原申请')
        self.path = f'/api/changes/{self.record.pk}/materials/'
        self.client = APIClient(enforce_csrf_checks=True)
        self.login()

    def login(self):
        token = self.client.get('/api/auth/csrf/').json()['csrfToken']
        response = self.client.post('/api/auth/login/', {'username': self.owner.username, 'password': 'test-password'}, format='json', HTTP_X_CSRFTOKEN=token)
        self.assertEqual(response.status_code, 200)
        self.client.credentials(HTTP_X_CSRFTOKEN=response.json()['csrfToken'])

    def test_three_categories_crud_and_relogin_recovery(self):
        self.assertEqual(connection.vendor, 'mysql')
        self.assertEqual(self.client.get(self.path).json(), [])
        for category, extra in [
            ('revision', {'old_revision': '01', 'new_revision': '02', 'change_description': '升版🧪'}),
            ('addition', {'revision': '00', 'detailed_class': '新增详细分类'}),
            ('discontinuation', {'revision': 'C', 'discontinued_project': 'INOwill', 'change_description': '停用说明'}),
        ]:
            with self.subTest(category=category):
                before = ChangeRequest.objects.get(pk=self.record.pk).updated_at
                payload = {'category': category, 'material_no': '000003151', 'description': '描述\n第二行', 'material_class': '成品', 'spare_part': '', 'optional_part': 'N', **extra}
                response = self.client.post(self.path, payload, format='json')
                self.assertEqual(response.status_code, 201, response.data)
                material_id = response.json()['id']
                self.assertGreater(ChangeRequest.objects.get(pk=self.record.pk).updated_at, before)
                detail_path = self.path + str(material_id) + '/'
                changed = self.client.patch(detail_path, {'description': '修改', 'spare_part': 'Y'}, format='json')
                self.assertEqual(changed.status_code, 200)
                self.assertEqual(changed.json()['material_no'], '000003151')
                self.assertEqual(changed.json()['optional_part'], 'N')
        self.assertEqual(self.client.post('/api/auth/logout/').status_code, 200)
        self.login()
        restored = self.client.get(self.path).json()
        self.assertEqual(len(restored), 3)
        self.assertEqual([row['id'] for row in restored], sorted(row['id'] for row in restored))
        self.assertTrue(all(row['material_no'] == '000003151' and row['spare_part'] == 'Y' for row in restored))
        for row in restored:
            before = ChangeRequest.objects.get(pk=self.record.pk).updated_at
            response = self.client.delete(self.path + str(row['id']) + '/')
            self.assertEqual(response.status_code, 204)
            self.assertEqual(response.content, b'')
            self.assertGreater(ChangeRequest.objects.get(pk=self.record.pk).updated_at, before)
        self.assertEqual(self.client.get(self.path).json(), [])

    def test_blank_fields_duplicate_numbers_and_text_boundaries(self):
        for _ in range(2):
            response = self.client.post(self.path, {'category': 'addition'}, format='json')
            self.assertEqual(response.status_code, 201)
            self.assertEqual(response.json()['spare_part'], '')
            self.assertEqual(response.json()['optional_part'], '')
        for _ in range(2):
            response = self.client.post(self.path, {'category': 'revision', 'material_no': '字' * 255, 'description': '长' * 1000}, format='json')
            self.assertEqual(response.status_code, 201)
        material = MaterialChange.objects.first()
        response = self.client.patch(self.path + str(material.pk) + '/', {'material_no': '', 'spare_part': 'N', 'optional_part': 'Y'}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['material_no'], '')

    def test_invalid_payloads_do_not_partially_save_or_touch_parent(self):
        material = MaterialChange.objects.create(change=self.record, category='addition', description='原描述')
        detail_path = self.path + str(material.pk) + '/'
        original_time = self.record.updated_at
        for invalid in [{'id': 2}, {'change': self.record.pk}, {'unknown': ''}, {'category': 'revision'}, {'old_revision': ''}, {'change_description': '不适用'}, {'material_no': '字' * 256}, {'spare_part': 'X'}, {'optional_part': None}]:
            with self.subTest(invalid=invalid):
                response = self.client.patch(detail_path, {'description': '不能写入', **invalid}, format='json')
                self.assertEqual(response.status_code, 400, response.data)
                material.refresh_from_db()
                self.record.refresh_from_db()
                self.assertEqual(material.description, '原描述')
                self.assertEqual(self.record.updated_at, original_time)
        for payload in [[], {'category': []}, {}, {'category': 'unknown'}, {'category': 'revision', 'revision': ''}, {'category': 'discontinuation', 'detailed_class': ''}]:
            with self.subTest(payload=payload):
                self.assertEqual(self.client.post(self.path, payload, format='json').status_code, 400)
        self.assertEqual(MaterialChange.objects.count(), 1)

    def test_user_and_parent_isolation_and_missing_ids(self):
        foreign = ChangeRequest.objects.create(applicant=self.other)
        same_owner = ChangeRequest.objects.create(applicant=self.owner)
        material = MaterialChange.objects.create(change=foreign, category='addition')
        own_material = MaterialChange.objects.create(change=self.record, category='addition')
        for record_id in [foreign.pk, 999999]:
            path = f'/api/changes/{record_id}/materials/'
            self.assertEqual(self.client.get(path).status_code, 404)
            self.assertEqual(self.client.post(path, {'category': 'addition'}, format='json').status_code, 404)
            self.assertEqual(self.client.patch(path + str(own_material.pk) + '/', {}, format='json').status_code, 404)
            self.assertEqual(self.client.delete(path + str(own_material.pk) + '/').status_code, 404)
        for path in [self.path + str(material.pk) + '/', f'/api/changes/{same_owner.pk}/materials/{own_material.pk}/', self.path + '999999/']:
            self.assertEqual(self.client.patch(path, {}, format='json').status_code, 404)
            self.assertEqual(self.client.delete(path).status_code, 404)
        self.assertEqual(MaterialChange.objects.count(), 2)

    def test_authentication_csrf_and_unsupported_methods(self):
        material = MaterialChange.objects.create(change=self.record, category='addition')
        path = self.path + str(material.pk) + '/'
        self.client.credentials()
        self.assertEqual(self.client.post(self.path, {'category': 'addition'}, format='json').status_code, 403)
        self.assertEqual(self.client.patch(path, {}, format='json').status_code, 403)
        self.assertEqual(self.client.delete(path).status_code, 403)
        anonymous = APIClient()
        self.assertEqual(anonymous.get(self.path).status_code, 403)
        self.assertEqual(anonymous.post(self.path, {'category': 'addition'}, format='json').status_code, 403)
        self.assertEqual(anonymous.patch(path, {}, format='json').status_code, 403)
        self.assertEqual(anonymous.delete(path).status_code, 403)
        self.login()
        self.assertEqual(self.client.put(path, {}, format='json').status_code, 405)
        self.assertEqual(self.client.post(path, {}, format='json').status_code, 405)

    def test_locked_application_rejects_all_material_writes(self):
        material = MaterialChange.objects.create(change=self.record, category='addition')
        path = self.path + str(material.pk) + '/'
        for state in ['pending', 'approved']:
            ChangeRequest.objects.filter(pk=self.record.pk).update(status=state)
            self.assertEqual(self.client.get(self.path).status_code, 200)
            self.assertEqual(self.client.post(self.path, {'category': 'addition'}, format='json').status_code, 409)
            self.assertEqual(self.client.patch(path, {'description': '修改'}, format='json').status_code, 409)
            self.assertEqual(self.client.delete(path).status_code, 409)
        material.refresh_from_db()
        self.assertEqual(material.description, '')

    def test_database_rejects_invalid_category_and_flags(self):
        for values in [{'category': 'invalid'}, {'category': 'addition', 'spare_part': 'X'}, {'category': 'addition', 'optional_part': 'X'}]:
            with self.subTest(values=values), self.assertRaises(IntegrityError), transaction.atomic():
                MaterialChange.objects.create(change=self.record, **values)

    def test_expected_account_rejects_stale_context_for_reads_and_writes(self):
        material = MaterialChange.objects.create(change=self.record, category='revision')
        self.client.credentials(HTTP_X_CSRFTOKEN=self.client.cookies['csrftoken'].value, HTTP_X_EXPECTED_USER=str(self.other.pk))
        attempts = [
            ('get', '/api/changes/', None), ('post', '/api/changes/', {}),
            ('get', f'/api/changes/{self.record.pk}/', None),
            ('patch', f'/api/changes/{self.record.pk}/', {'title': '不得保存'}),
            ('delete', f'/api/changes/{self.record.pk}/', None),
            ('get', self.path, None), ('post', self.path, {'category': 'addition'}),
            ('patch', self.path + str(material.pk) + '/', {'description': '不得保存'}),
            ('delete', self.path + str(material.pk) + '/', None),
            ('post', '/api/auth/logout/', None),
        ]
        for method, path, data in attempts:
            with self.subTest(method=method, path=path):
                response = getattr(self.client, method)(path, data, format='json')
                self.assertEqual(response.status_code, 409)
                self.assertEqual(response.json()['code'], 'account_changed')
        self.record.refresh_from_db()
        material.refresh_from_db()
        self.assertEqual(self.record.title, '原申请')
        self.assertEqual(material.description, '')
        self.assertEqual(ChangeRequest.objects.count(), 1)
        self.assertEqual(MaterialChange.objects.count(), 1)
        self.assertEqual(self.client.get('/api/auth/me/').status_code, 200)
        self.client.credentials(HTTP_X_CSRFTOKEN=self.client.cookies['csrftoken'].value, HTTP_X_EXPECTED_USER=str(self.owner.pk))
        self.assertEqual(self.client.post('/api/changes/', {}, format='json').status_code, 201)

    def test_dispositions_save_restore_partial_clear_and_cascade(self):
        for category in ['revision', 'discontinuation']:
            created = self.client.post(self.path, {'category': category, 'material_no': '00001', 'dispositions': {'company_finished': {'disposition': 'NA', 'remark': '保留'}, 'customer_site': {'disposition': 'Rework', 'remark': '返工'}}}, format='json')
            self.assertEqual(created.status_code, 201, created.data)
            material_id = created.json()['id']
            path = self.path + str(material_id) + '/'
            self.assertEqual(created.json()['dispositions']['company_finished']['remark'], '保留')
            self.login()
            restored = next(row for row in self.client.get(self.path).json() if row['id'] == material_id)
            self.assertEqual(restored['dispositions'], created.json()['dispositions'])
            changed = self.client.patch(path, {'dispositions': {'company_finished': {'remark': ''}}}, format='json')
            self.assertEqual(changed.status_code, 200, changed.data)
            self.assertEqual(changed.json()['dispositions']['company_finished'], {'disposition': 'NA', 'remark': ''})
            self.assertEqual(changed.json()['dispositions']['customer_site']['remark'], '返工')
            cleared = self.client.patch(path, {'dispositions': {'company_finished': {'disposition': ''}}}, format='json')
            self.assertNotIn('company_finished', cleared.json()['dispositions'])
            self.assertEqual(self.client.delete(path).status_code, 204)
            self.assertFalse(MaterialDisposition.objects.filter(material_id=material_id).exists())
        material = MaterialChange.objects.create(change=self.record, category='revision')
        MaterialDisposition.objects.create(material=material, location_group='customer', location_item='customer_site', disposition='NA')
        self.assertEqual(self.client.delete(f'/api/changes/{self.record.pk}/').status_code, 204)
        self.assertFalse(MaterialDisposition.objects.filter(material_id=material.pk).exists())

    def test_invalid_dispositions_and_addition_do_not_partially_save(self):
        material = MaterialChange.objects.create(change=self.record, category='revision', description='原描述')
        for positions in [[], {'unknown': {}}, {'company_finished': {'disposition': 'INVALID'}}, {'company_finished': {'remark': None}}, {'company_finished': {'location_group': 'supplier'}}, {'company_finished': []}]:
            with self.subTest(positions=positions):
                response = self.client.patch(self.path + str(material.pk) + '/', {'description': '不可写入', 'dispositions': positions}, format='json')
                self.assertEqual(response.status_code, 400, response.data)
                material.refresh_from_db()
                self.assertEqual(material.description, '原描述')
        self.assertEqual(self.client.post(self.path, {'category': 'addition', 'dispositions': {}}, format='json').status_code, 400)
        self.assertEqual(MaterialDisposition.objects.count(), 0)

    def test_disposition_transaction_failure_rolls_back_material_and_positions(self):
        material = MaterialChange.objects.create(change=self.record, category='revision', description='原描述')
        original = MaterialDisposition.objects.update_or_create
        def fail_customer(**kwargs):
            if kwargs['location_item'] == 'customer_site':
                raise RuntimeError('simulated disposition failure')
            return original(**kwargs)
        with patch.object(MaterialDisposition.objects, 'update_or_create', side_effect=fail_customer), self.assertRaises(RuntimeError):
            self.client.patch(self.path + str(material.pk) + '/', {'description': '新描述', 'dispositions': {'company_finished': {'disposition': 'NA'}, 'customer_site': {'disposition': 'Rework'}}}, format='json')
        material.refresh_from_db()
        self.assertEqual(material.description, '原描述')
        self.assertEqual(MaterialDisposition.objects.count(), 0)

    def test_disposition_constraints_and_retry_payload(self):
        payload = {'category': 'revision', 'request_id': str(uuid4()), 'dispositions': {'company_finished': {'disposition': 'NA', 'remark': '原备注'}}}
        first = self.client.post(self.path, payload, format='json')
        self.assertEqual(first.status_code, 201, first.data)
        replay = self.client.post(self.path, payload, format='json')
        self.assertEqual(replay.status_code, 200)
        self.assertEqual(replay.json(), first.json())
        self.assertEqual(MaterialDisposition.objects.count(), 1)
        changed = self.client.post(self.path, {**payload, 'dispositions': {'company_finished': {'disposition': 'Rework'}}}, format='json')
        self.assertEqual(changed.status_code, 409)
        material = MaterialChange.objects.get(pk=first.json()['id'])
        for values in [dict(location_group='company', location_item='company_finished', disposition='NA'), dict(location_group='supplier', location_item='company_raw', disposition='NA'), dict(location_group='company', location_item='company_raw', disposition='UNKNOWN')]:
            with self.subTest(values=values), self.assertRaises(IntegrityError), transaction.atomic():
                MaterialDisposition.objects.create(material=material, **values)

    def test_draft_delete_cascades_materials_and_releases_numbers(self):
        self.record.ecr_no = 'DELETE-ECR'
        self.record.eco_no = 'DELETE-ECO'
        self.record.save()
        material = MaterialChange.objects.create(change=self.record, category='revision')
        path = f'/api/changes/{self.record.pk}/'
        response = self.client.delete(path)
        self.assertEqual(response.status_code, 204)
        self.assertEqual(response.content, b'')
        self.assertFalse(ChangeRequest.objects.filter(pk=self.record.pk).exists())
        self.assertFalse(MaterialChange.objects.filter(pk=material.pk).exists())
        self.assertEqual(self.client.get(path).status_code, 404)
        self.assertEqual(self.client.delete(path).status_code, 404)
        replacement = self.client.post('/api/changes/', {'ecr_no': 'DELETE-ECR', 'eco_no': 'DELETE-ECO'}, format='json')
        self.assertEqual(replacement.status_code, 201)

    def test_application_delete_enforces_owner_auth_csrf_and_state(self):
        path = f'/api/changes/{self.record.pk}/'
        self.assertEqual(self.client.put(path, {}, format='json').status_code, 405)
        material = MaterialChange.objects.create(change=self.record, category='addition')
        foreign = ChangeRequest.objects.create(applicant=self.other)
        self.assertEqual(self.client.delete(f'/api/changes/{foreign.pk}/').status_code, 404)
        self.assertEqual(self.client.delete('/api/changes/999999/').status_code, 404)
        self.assertEqual(APIClient().delete(path).status_code, 403)
        self.client.credentials()
        self.assertEqual(self.client.delete(path).status_code, 403)
        self.login()
        for state in ['pending', 'approved']:
            ChangeRequest.objects.filter(pk=self.record.pk).update(status=state)
            self.assertEqual(self.client.delete(path).status_code, 409)
        self.assertTrue(MaterialChange.objects.filter(pk=material.pk).exists())
        self.assertTrue(ChangeRequest.objects.filter(pk=foreign.pk).exists())

    def test_create_retry_returns_original_without_touching_data(self):
        payload = {'category': 'addition', 'request_id': str(uuid4()), 'material_no': '00001'}
        first = self.client.post(self.path, payload, format='json')
        self.assertEqual(first.status_code, 201, first.data)
        updated_at = ChangeRequest.objects.get(pk=self.record.pk).updated_at
        replay = self.client.post(self.path, payload, format='json')
        self.assertEqual(replay.status_code, 200, replay.data)
        self.assertEqual(replay.json(), first.json())
        self.assertNotIn('request_id', replay.json())
        self.assertEqual(MaterialChange.objects.count(), 1)
        self.assertEqual(ChangeRequest.objects.get(pk=self.record.pk).updated_at, updated_at)
        changed = self.client.post(self.path, {**payload, 'description': '重试修改'}, format='json')
        self.assertEqual(changed.status_code, 409)
        self.assertEqual(MaterialChange.objects.get().description, '')
        self.assertEqual(self.client.patch(self.path + str(first.json()['id']) + '/', {'request_id': str(uuid4())}, format='json').status_code, 400)
        self.assertEqual(self.client.post(self.path, {'category': 'addition', 'request_id': 'invalid'}, format='json').status_code, 400)

    def test_create_request_id_is_scoped_to_application_and_database_enforced(self):
        request_id = uuid4()
        material = MaterialChange.objects.create(change=self.record, category='addition', request_id=request_id)
        with self.assertRaises(IntegrityError), transaction.atomic():
            MaterialChange.objects.create(change=self.record, category='addition', request_id=request_id)
        other_record = ChangeRequest.objects.create(applicant=self.other)
        MaterialChange.objects.create(change=other_record, category='addition', request_id=request_id)
        own_record = ChangeRequest.objects.create(applicant=self.owner)
        response = self.client.post(f'/api/changes/{own_record.pk}/materials/', {'category': 'addition', 'request_id': str(request_id)}, format='json')
        self.assertEqual(response.status_code, 201)
        self.assertNotEqual(response.json()['id'], material.pk)


class ConcurrentMaterialTests(TransactionTestCase):
    def setUp(self):
        self.owner = get_user_model().objects.create_user('material-concurrent')
        self.record = ChangeRequest.objects.create(applicant=self.owner)
        self.material = MaterialChange.objects.create(change=self.record, category='addition')

    def write_from_connection(self, method, values, barrier=None, started=None):
        try:
            client = APIClient()
            client.force_authenticate(user=self.owner)
            path = f'/api/changes/{self.record.pk}/materials/'
            if method == 'delete_request':
                path = f'/api/changes/{self.record.pk}/'
            elif method != 'post':
                path += f'{self.material.pk}/'
            if barrier:
                barrier.wait(timeout=10)
            def mark_select(execute, sql, params, many, context):
                if started and sql.lstrip().upper().startswith('SELECT') and 'change_request' in sql:
                    started.set()
                return execute(sql, params, many, context)
            with connection.execute_wrapper(mark_select):
                return getattr(client, 'delete' if method == 'delete_request' else method)(path, values, format='json').status_code
        finally:
            connections.close_all()

    def test_parallel_partial_updates_keep_both_fields(self):
        self.assertEqual(connection.vendor, 'mysql')
        barrier = Barrier(2)
        with ThreadPoolExecutor(max_workers=2) as executor:
            first = executor.submit(self.write_from_connection, 'patch', {'description': '新描述'}, barrier)
            second = executor.submit(self.write_from_connection, 'patch', {'material_no': '000003151'}, barrier)
            self.assertEqual(first.result(timeout=15), 200)
            self.assertEqual(second.result(timeout=15), 200)
        self.material.refresh_from_db()
        self.assertEqual((self.material.description, self.material.material_no), ('新描述', '000003151'))

    def test_material_read_blocks_writer_until_both_queries_complete(self):
        self.material.category = 'revision'
        self.material.description = 'old-basic'
        self.material.save(update_fields=['category', 'description'])
        MaterialDisposition.objects.create(material=self.material, location_group='company', location_item='company_finished', disposition='NA', remark='old-disposition')
        started = Event()
        triggered = False
        future = None
        with ThreadPoolExecutor(max_workers=1) as executor:
            def interleave(execute, sql, params, many, context):
                nonlocal triggered, future
                result = execute(sql, params, many, context)
                if not triggered and sql.lstrip().upper().startswith('SELECT') and 'FROM `material_change`' in sql:
                    triggered = True
                    future = executor.submit(self.write_from_connection, 'patch', {'description': 'new-basic', 'dispositions': {'company_finished': {'remark': 'new-disposition'}}}, None, started)
                    self.assertTrue(started.wait(timeout=10))
                    with self.assertRaises(TimeoutError):
                        future.result(timeout=0.15)
                return result
            client = APIClient()
            client.force_authenticate(user=self.owner)
            with connection.execute_wrapper(interleave):
                response = client.get(f'/api/changes/{self.record.pk}/materials/')
            self.assertTrue(triggered)
            self.assertEqual(response.status_code, 200)
            row = response.json()[0]
            self.assertEqual((row['description'], row['dispositions']['company_finished']['remark']), ('old-basic', 'old-disposition'))
            self.assertEqual(future.result(timeout=15), 200)
        self.material.refresh_from_db()
        self.assertEqual(self.material.description, 'new-basic')
        self.assertEqual(MaterialDisposition.objects.get(material=self.material).remark, 'new-disposition')

    def test_concurrent_create_retries_share_one_record(self):
        barrier = Barrier(2)
        payload = {'category': 'addition', 'request_id': str(uuid4()), 'material_no': 'RETRY'}
        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(self.write_from_connection, 'post', payload, barrier) for _ in range(2)]
            self.assertEqual(sorted(future.result(timeout=15) for future in futures), [200, 201])
        self.assertEqual(MaterialChange.objects.filter(material_no='RETRY').count(), 1)

    def test_parallel_disposition_cells_keep_both_updates(self):
        self.material.category = 'revision'
        self.material.save(update_fields=['category'])
        barrier = Barrier(2)
        with ThreadPoolExecutor(max_workers=2) as executor:
            first = executor.submit(self.write_from_connection, 'patch', {'dispositions': {'company_finished': {'disposition': 'NA'}}}, barrier)
            second = executor.submit(self.write_from_connection, 'patch', {'dispositions': {'company_finished': {'remark': '并行备注'}}}, barrier)
            self.assertEqual(first.result(timeout=15), 200)
            self.assertEqual(second.result(timeout=15), 200)
        row = MaterialDisposition.objects.get(material=self.material)
        self.assertEqual((row.disposition, row.remark), ('NA', '并行备注'))

    def test_writes_wait_for_parent_lock_and_recheck_state(self):
        for method, values in [('post', {'category': 'addition'}), ('patch', {'description': '新描述'}), ('delete', {})]:
            with self.subTest(method=method):
                ChangeRequest.objects.filter(pk=self.record.pk).update(status='draft')
                started = Event()
                with ThreadPoolExecutor(max_workers=1) as executor:
                    with transaction.atomic():
                        locked = ChangeRequest.objects.select_for_update().get(pk=self.record.pk)
                        future = executor.submit(self.write_from_connection, method, values, None, started)
                        self.assertTrue(started.wait(timeout=10))
                        with self.assertRaises(TimeoutError):
                            future.result(timeout=0.15)
                        locked.status = 'pending'
                        locked.save(update_fields=['status'])
                    self.assertEqual(future.result(timeout=15), 409)
        self.assertEqual(MaterialChange.objects.count(), 1)

    def test_application_delete_waits_for_save_lock_and_rechecks_state(self):
        started = Event()
        with ThreadPoolExecutor(max_workers=1) as executor:
            with transaction.atomic():
                locked = ChangeRequest.objects.select_for_update().get(pk=self.record.pk)
                future = executor.submit(self.write_from_connection, 'delete_request', {}, None, started)
                self.assertTrue(started.wait(timeout=10))
                with self.assertRaises(TimeoutError):
                    future.result(timeout=0.15)
                locked.status = 'pending'
                locked.save(update_fields=['status'])
            self.assertEqual(future.result(timeout=15), 409)
        self.assertTrue(MaterialChange.objects.filter(pk=self.material.pk).exists())

    def test_application_delete_serializes_after_save_and_save_after_delete_is_rejected(self):
        for delete_first in [False, True]:
            with self.subTest(delete_first=delete_first):
                self.record = ChangeRequest.objects.create(applicant=self.owner)
                self.material = MaterialChange.objects.create(change=self.record, category='addition')
                started = Event()
                with ThreadPoolExecutor(max_workers=1) as executor:
                    with transaction.atomic():
                        locked = ChangeRequest.objects.select_for_update().get(pk=self.record.pk)
                        if delete_first:
                            locked.delete()
                        else:
                            locked.title = '保存完成'
                            locked.save(update_fields=['title'])
                        future = executor.submit(self.write_from_connection, 'patch' if delete_first else 'delete_request', {'description': '保存内容'} if delete_first else {}, None, started)
                        self.assertTrue(started.wait(timeout=10))
                        with self.assertRaises(TimeoutError):
                            future.result(timeout=0.15)
                    self.assertEqual(future.result(timeout=15), 404 if delete_first else 204)
                self.assertFalse(ChangeRequest.objects.filter(pk=self.record.pk).exists())
                self.assertFalse(MaterialChange.objects.filter(pk=self.material.pk).exists())
