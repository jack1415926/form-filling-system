import hashlib
import json
import os
import secrets
import uuid
from pathlib import Path

from django.apps import apps
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.contrib.sessions.models import Session
from django.db import connection, transaction
from django.test import Client
from changes.models import ChangeRequest, SystemFeedback

folder = Path('../.local/system-feedback-browser')
folder.mkdir(exist_ok=True)
fixture_file = folder / 'fixture.json'
User = get_user_model()


def snapshot():
    result = {}
    tables = [model._meta.db_table for model in apps.get_app_config('changes').get_models()] + ['auth_user', 'auth_user_groups']
    with connection.cursor() as cursor:
        for table in tables:
            cursor.execute('SELECT * FROM '+connection.ops.quote_name(table)+' ORDER BY 1')
            rows = cursor.fetchall()
            result[table] = {'rows': len(rows), 'sha256': hashlib.sha256(json.dumps(rows, default=str, ensure_ascii=False).encode()).hexdigest()}
    return result


action = os.environ['FEEDBACK_FIXTURE_ACTION']
assert action in ['prepare', 'revoke', 'cleanup']
if action == 'prepare':
    assert not fixture_file.exists(), 'Clean up the previous fixture first'
    before = snapshot()
    suffix = secrets.token_hex(4)
    accounts = []
    with transaction.atomic():
        for kind in ['owner', 'reviewer', 'admin', 'other']:
            password = secrets.token_urlsafe(16)
            user = User.objects.create_user(username=f'sys_feedback_{kind}_{suffix}', password=password)
            if kind == 'reviewer': user.groups.add(Group.objects.get(name='审核员'))
            if kind == 'admin': user.groups.add(Group.objects.get(name='反馈管理员'))
            accounts.append({'id': user.pk, 'username': user.username, 'password': password, 'kind': kind})
        owner, reviewer = accounts[:2]
        client = Client()
        client.force_login(User.objects.get(pk=owner['id']))
        records = []
        for index in [1, 2]:
            response = client.post('/api/changes/', json.dumps({'title': '反馈回归临时申请'+str(index), 'ecr_no': f'SF-{suffix}-{index}'}), content_type='application/json')
            assert response.status_code == 201
            records.append(response.json()['id'])
        response = client.post(f'/api/changes/{records[1]}/submission/', json.dumps({'review_mode': 'designated', 'reviewer_ids': [reviewer['id']], 'expected_round': 0, 'request_id': str(uuid.uuid4())}), content_type='application/json')
        assert response.status_code == 200
        client.logout()
        client.force_login(User.objects.get(pk=accounts[2]['id']))
        response = client.post('/api/changes/', json.dumps({'title': '管理员自己的填写草稿', 'ecr_no': f'SF-{suffix}-admin'}), content_type='application/json')
        assert response.status_code == 201
        records.append(response.json()['id'])
        client.logout()
    fixture_file.write_text(json.dumps({'accounts': accounts, 'records': records, 'before': before}, ensure_ascii=False, indent=2), encoding='utf-8')
    print('Independent feedback fixture prepared')
else:
    fixture = json.loads(fixture_file.read_text(encoding='utf-8'))
    if action == 'revoke':
        admin = fixture['accounts'][2]
        user = User.objects.get(pk=admin['id'], username=admin['username'])
        user.groups.remove(Group.objects.get(name='反馈管理员'))
        print('Temporary feedback administrator permission revoked')
    else:
        with transaction.atomic():
            for account in fixture['accounts']:
                user = User.objects.get(pk=account['id'], username=account['username'])
                assert user.username.startswith('sys_feedback_')
                SystemFeedback.objects.filter(submitter=user).delete()
                ChangeRequest.objects.filter(applicant=user).delete()
                keys = [session.session_key for session in Session.objects.all() if str(session.get_decoded().get('_auth_user_id')) == str(user.pk)]
                Session.objects.filter(session_key__in=keys).delete()
                user.delete()
        after = snapshot()
        result = {'temporary_data_removed': True, 'original_business_and_user_data_unchanged': after == fixture['before'], 'business_tables': len(after)-2}
        (folder / 'cleanup.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
        fixture_file.unlink()
        print(result)
        assert after == fixture['before'], 'Original snapshots differ'
