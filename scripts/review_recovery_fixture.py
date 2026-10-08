import hashlib
import json
import secrets
import os
import uuid
from pathlib import Path
from django.apps import apps
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.contrib.sessions.models import Session
from django.db import connection, transaction
from django.test import Client
from changes.models import ChangeRequest

folder = Path('../.local/review-recovery-browser')
folder.mkdir(exist_ok=True)
fixture_file = folder / 'fixture.json'
User = get_user_model()


def snapshot():
    result = {}
    for model in apps.get_app_config('changes').get_models():
        table = model._meta.db_table
        with connection.cursor() as cursor:
            cursor.execute(f'SELECT * FROM {connection.ops.quote_name(table)} ORDER BY id')
            rows = cursor.fetchall()
        result[table] = {'rows': len(rows), 'sha256': hashlib.sha256(json.dumps(rows, default=str, ensure_ascii=False).encode()).hexdigest()}
    return result


action = os.environ['REVIEW_FIXTURE_ACTION']
assert action in ['prepare', 'cleanup']
if action == 'prepare':
    assert not fixture_file.exists(), 'A previous fixture exists; clean it up before preparing another'
    before = snapshot()
    suffix = secrets.token_hex(4)
    account_rows = []
    with transaction.atomic():
        group = Group.objects.get(name='审核员')
        for role in ['filler', 'reviewer']:
            user = User.objects.create_user(username=f'whole_review_{role}_{suffix}', password='123456')
            if role == 'reviewer':
                user.groups.add(group)
            account_rows.append({'id': user.pk, 'username': user.username, 'password': '123456', 'role': role})
        client = Client()
        client.force_login(User.objects.get(pk=account_rows[0]['id']))
        records = []
        for number in [1, 2]:
            response = client.post('/api/changes/', data=json.dumps({'title': f'全项目复查{number}（临时）', 'ecr_no': f'WR-{suffix}-{number}'}), content_type='application/json')
            assert response.status_code == 201, response.content
            records.append(response.json()['id'])
        response = client.post(f'/api/changes/{records[0]}/submission/', data=json.dumps({'review_mode': 'designated', 'reviewer_ids': [account_rows[1]['id']], 'expected_round': 0, 'request_id': str(uuid.uuid4())}), content_type='application/json')
        assert response.status_code == 200, response.content
        client.logout()
    fixture_file.write_text(json.dumps({'accounts': account_rows, 'records': records, 'before': before}, ensure_ascii=False, indent=2), encoding='utf-8')
    print('Independent review fixture prepared:', records)
else:
    fixture = json.loads(fixture_file.read_text(encoding='utf-8'))
    with transaction.atomic():
        for account in fixture['accounts']:
            user = User.objects.get(pk=account['id'], username=account['username'])
            assert user.username.startswith('whole_review_')
            ChangeRequest.objects.filter(applicant=user).delete()
            keys = [row.session_key for row in Session.objects.all() if str(row.get_decoded().get('_auth_user_id')) == str(user.pk)]
            Session.objects.filter(session_key__in=keys).delete()
            user.delete()
    after = snapshot()
    result = {'temporary_data_removed': True, 'original_business_tables_unchanged': after == fixture['before'], 'table_count': len(after)}
    (folder / 'cleanup.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    fixture_file.unlink()
    print(result)
    assert after == fixture['before'], 'Business table snapshots differ; inspect independently'
