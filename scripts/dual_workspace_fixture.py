"""Independent browser fixtures; invoked by the paired PowerShell runner."""
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
from changes.models import ChangeRequest, EcrActionResponse, EcoActionResponse

folder = Path('../.local/dual-workspace-20261012')
folder.mkdir(exist_ok=True)
fixture_file = folder / 'fixture.json'
User = get_user_model()

def snapshot():
    tables = [model._meta.db_table for model in apps.get_app_config('changes').get_models()]
    tables += [User._meta.db_table, Group._meta.db_table, User.groups.through._meta.db_table]
    result = {}
    for table in tables:
        with connection.cursor() as cursor:
            cursor.execute(f'SELECT * FROM {connection.ops.quote_name(table)} ORDER BY id')
            rows = cursor.fetchall()
        result[table] = hashlib.sha256(json.dumps(rows, default=str, ensure_ascii=False).encode()).hexdigest()
    return result

action = os.environ['DUAL_FIXTURE_ACTION']
if action in ['prepare','prepare_assignment','prepare_owners']:
    assert not fixture_file.exists(), 'Clean previous fixture first'
    before = snapshot(); suffix = secrets.token_hex(5); accounts = []
    with transaction.atomic():
        group = Group.objects.get(name='审核员')
        roles = ['ordinary-a','ordinary-b'] if action in ['prepare_assignment','prepare_owners'] else ['owner','examiner','ordinary']
        for role in roles:
            password = secrets.token_urlsafe(16)
            user = User.objects.create_user(username=f'dual_{role}_{suffix}', password=password)
            reviewer = role in ['owner','examiner']
            if reviewer: user.groups.add(group)
            accounts.append({'id': user.pk, 'username': user.username, 'password': password, 'role': 'reviewer' if reviewer else 'filler'})
        client = Client(); records = {}
        def create(account, name, reviewer, returned=False):
            client.force_login(User.objects.get(pk=account['id']))
            def post(url, data):
                response = client.post(url, data=json.dumps(data), content_type='application/json')
                assert response.status_code in [200,201], response.content
                return response.json()
            result = post('/api/changes/', {'title': name, 'ecr_no': f'DUAL-{suffix}-{len(records)}'})
            pk = result['id']; records[name] = pk
            post(f'/api/changes/{pk}/submission/', {'review_mode':'designated','reviewer_ids':[reviewer['id']],'expected_round':0,'request_id':str(uuid.uuid4())})
            if returned:
                client.force_login(User.objects.get(pk=reviewer['id']))
                post(f'/api/changes/{pk}/review-rounds/1/return/', {'issues':[{'tab':'overview','text':'请补充变更原因'}],'request_id':str(uuid.uuid4())})
            client.logout()
            return pk
        if action in ['prepare_assignment','prepare_owners']:
            title='行动负责人关联（临时）' if action == 'prepare_owners' else '普通账号指定审核（临时）'
            change = ChangeRequest.objects.create(applicant_id=accounts[0]['id'],title=title,ecr_no=f'ASSIGNED-{suffix}')
            records[title] = change.pk
            if action == 'prepare_owners':
                EcrActionResponse.objects.create(change=change,action_key='ecr_001',owner='历史ECR负责人',result='原评估结果')
                EcoActionResponse.objects.create(change=change,action_key='eco_001',owner='历史ECO负责人',result='原执行结果')
        else:
            create(accounts[0], '本人退回申请（临时）', accounts[1], True)
            create(accounts[2], '他人待审核申请（临时）', accounts[0])
    fixture_file.write_text(json.dumps({'accounts':accounts,'records':records,'before':before},ensure_ascii=False,indent=2),encoding='utf-8')
    print('Independent dual-workspace fixture prepared.')
elif action in ['revoke','restore']:
    fixture = json.loads(fixture_file.read_text(encoding='utf-8'))
    user = User.objects.get(pk=fixture['accounts'][0]['id'],username=fixture['accounts'][0]['username'])
    group = Group.objects.get(name='审核员')
    if action == 'revoke': user.groups.remove(group)
    else: user.groups.add(group)
    print('Temporary account review capability updated.')
elif action == 'cleanup':
    fixture = json.loads(fixture_file.read_text(encoding='utf-8'))
    with transaction.atomic():
        users = [User.objects.get(pk=row['id'],username=row['username']) for row in fixture['accounts']]
        assert all(user.username.startswith('dual_') for user in users)
        ChangeRequest.objects.filter(applicant__in=users).delete()
        ids = {str(user.pk) for user in users}
        keys = [row.session_key for row in Session.objects.all() if str(row.get_decoded().get('_auth_user_id')) in ids]
        Session.objects.filter(session_key__in=keys).delete()
        for user in users: user.delete()
    result = {'temporary_data_removed':True,'business_and_accounts_unchanged':snapshot()==fixture['before']}
    (folder/'cleanup.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    assert result['business_and_accounts_unchanged'], 'Original data snapshot changed'
    fixture_file.unlink(); print(result)
else:
    raise ValueError('Unknown fixture action')
