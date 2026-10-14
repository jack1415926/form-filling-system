from django.test import TestCase, override_settings
from uuid import uuid4

from .models import ChangeRequest
from .test_publication import PublicationFixture


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class EngineeringChangesTests(PublicationFixture, TestCase):
    def test_eco_list_uses_its_own_changed_title_and_preserves_source_title(self):
        self.approve(); self.publish(); eco = self.create_eco()
        changed = self.client.patch(f'/api/changes/{eco.pk}/', {'title': 'Independent ECO title'}, format='json')
        self.assertEqual(changed.status_code, 200)
        self.assertEqual(self.listing('eco')[0]['title'], 'Independent ECO title')
        self.assertEqual(self.listing('ecr')[0]['title'], self.source.title)
        self.assertEqual(self.listing('all')[0]['title'], self.source.title)
        self.source.refresh_from_db()
        self.assertEqual(self.source.title, 'Baseline')

    def test_non_owner_return_revokes_body_but_retains_authorized_history(self):
        self.source.stage_approvers.set([self.a])
        self.client.patch(self.path + 'ecr-actions/ecr_001/', {'owner_user_ids': [self.b.pk], 'extra_required': True}, format='json')
        submitted = self.client.post(self.path + 'stage-submission/', {'request_id': str(uuid4()), 'expected_round': 0}, format='json')
        self.assertEqual(submitted.status_code, 200, submitted.data)
        self.client.force_authenticate(self.b)
        self.assertEqual(self.client.get(self.path).data['status'], 'pending')
        result = self.client.post(self.path + 'review-rounds/1/return/', {'request_id': str(uuid4()), 'issues': [{'tab': 'overview', 'text': 'Please revise'}]}, format='json')
        self.assertEqual(result.status_code, 200, result.data)
        self.assertEqual(result.data['round']['state'], 'returned')
        self.assertIsNone(result.data['form'])
        self.assertFalse(result.data['can_view_form'])
        self.assertEqual(self.client.get(self.path).status_code, 404)
        history = self.client.get(self.path + 'review-rounds/1/')
        self.assertEqual(history.status_code, 200)
        self.assertEqual(history.data['round']['state'], 'returned')

    def listing(self, workflow='all', state='all'):
        response = self.client.get('/api/engineering-changes/', {'workflow': workflow, 'state': state})
        self.assertEqual(response.status_code, 200, response.data)
        return response.data['items']

    def test_draft_group_delete_capability_and_invalid_filters(self):
        rows = self.listing()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['id'], self.source.pk)
        self.assertEqual(rows[0]['eco']['status'], 'not_created')
        self.assertTrue(rows[0]['can_delete_ecr'])
        self.assertFalse(rows[0]['can_create_eco'])
        for params in [{'workflow': 'legacy'}, {'state': 'not_created'}, {'state': 'incorrect'}]:
            self.assertEqual(self.client.get('/api/engineering-changes/', params).status_code, 400)

    def test_linked_processes_group_once_and_filter_on_the_selected_process(self):
        self.approve(); self.publish(); eco = self.create_eco()
        other = ChangeRequest.objects.create(applicant=self.a, title='Other draft')
        self.client.force_authenticate(self.a)
        rows = self.listing(); self.assertEqual(len(rows), 2)
        group = next(row for row in rows if row['id'] == self.source.pk)
        self.assertEqual(group['ecr']['status'], 'published')
        self.assertEqual(group['eco']['id'], eco.pk)
        self.assertEqual(group['eco']['status'], 'draft')
        self.assertFalse(group['can_create_eco']); self.assertFalse(group['can_delete_ecr'])
        self.assertEqual([row['id'] for row in self.listing('ecr', 'draft')], [other.pk])
        self.assertEqual([row['id'] for row in self.listing('eco', 'draft')], [self.source.pk])
        self.assertEqual(self.listing('eco', 'published'), [])
        self.assertEqual(len(self.listing('all', 'draft')), 2)

    def test_eco_filler_gets_source_brief_without_ecr_body_or_hidden_history(self):
        self.approve(); self.publish()
        self.client.force_authenticate(self.a)
        response = self.client.post(self.path + 'eco/', {'request_id': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'filler_id': self.d.pk}, format='json')
        self.assertEqual(response.status_code, 201)
        eco_id = response.data['change']['id']
        self.client.force_authenticate(self.d)
        rows = self.listing('eco', 'draft')
        self.assertEqual(len(rows), 1)
        self.assertFalse(rows[0]['ecr']['can_open'])
        self.assertEqual(rows[0]['ecr']['number'], self.source.ecr_no)
        self.assertIsNone(rows[0]['ecr']['current_round'])
        self.assertTrue(rows[0]['eco']['can_open'])
        self.assertFalse(rows[0]['can_create_eco'])
        self.assertEqual(self.listing('ecr'), [])
        self.assertEqual(self.listing('all', 'published'), [])
        self.assertEqual(self.client.get(self.path).status_code, 404)
        self.assertEqual(self.client.get(f'/api/changes/{eco_id}/').status_code, 200)

    def test_ecr_task_reader_does_not_leak_linked_private_eco_or_filter_by_its_state(self):
        self.approve(with_task=True); self.publish(); eco = self.create_eco()
        eco.eco_no = 'PRIVATE-ECO'; eco.save()
        self.client.force_authenticate(self.b)
        group = self.listing()[0]
        self.assertTrue(group['ecr']['can_open'])
        self.assertEqual(group['eco']['status'], 'unavailable')
        for field in ['id', 'number', 'current_round', 'updated_at']:
            self.assertIsNone(group['eco'][field])
        self.assertNotIn('PRIVATE-ECO', str(group))
        self.assertEqual(self.listing('eco'), [])
        self.assertEqual(self.listing('all', 'draft'), [])

    def test_coordinators_can_track_eco_but_cannot_write_after_handoff(self):
        self.approve(); self.publish()
        self.client.force_authenticate(self.a)
        response = self.client.post(self.path + 'eco/', {'request_id': 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'filler_id': self.d.pk}, format='json')
        eco_id = response.data['change']['id']
        for actor in [self.a, self.c]:
            self.client.force_authenticate(actor)
            row = self.listing()[0]
            self.assertTrue(row['ecr']['can_open']); self.assertTrue(row['eco']['can_open'])
            self.assertFalse(row['can_create_eco'])
            self.assertEqual(self.client.patch(f'/api/changes/{eco_id}/', {'title': 'Cannot replace filler'}, format='json').status_code, 409)

    def test_staff_outsider_and_inactive_accounts_do_not_gain_list_access(self):
        self.d.is_staff = True; self.d.is_superuser = True; self.d.save()
        self.client.force_authenticate(self.d)
        self.assertEqual(self.listing(), [])
        self.client.force_authenticate(self.a)
        self.a.is_active = False; self.a.save()
        self.assertEqual(self.listing(), [])

    def test_final_approval_returns_consistent_process_and_round_states_for_both_flows(self):
        def approve_process(record):
            record.stage_approvers.set([self.a, self.c])
            path = f'/api/changes/{record.pk}/'
            self.client.force_authenticate(self.a)
            submitted = self.client.post(path + 'stage-submission/', {'request_id': str(uuid4()), 'expected_round': 0, 'acknowledge_no_tasks': True}, format='json')
            self.assertEqual(submitted.status_code, 200, submitted.data)
            first = self.client.post(path + 'review-rounds/1/approve/', {'request_id': str(uuid4())}, format='json')
            self.assertEqual(first.data['round']['state'], 'pending')
            self.client.force_authenticate(self.c)
            final = self.client.post(path + 'review-rounds/1/approve/', {'request_id': str(uuid4())}, format='json')
            self.assertEqual(final.status_code, 200, final.data)
            self.assertEqual(final.data['form']['status'], 'approved')
            self.assertEqual(final.data['round']['state'], 'approved')
            self.assertIsNotNone(final.data['round']['approved_at'])
            self.assertFalse(final.data['can_approve'])
            record.refresh_from_db()
        approve_process(self.source)
        self.publish()
        eco = self.create_eco(); eco.eco_no = 'ECO-RESPONSE'; eco.publisher = self.c; eco.save()
        approve_process(eco)
        self.source.refresh_from_db()
        self.assertEqual(self.source.status, 'published')
