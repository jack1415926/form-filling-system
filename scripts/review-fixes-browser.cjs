// Requires the Vite server and PLAYWRIGHT_MODULE (same runner as the feedback checks).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const local = path.join(root, 'frontend', '.local');
fs.mkdirSync(local, { recursive: true });
const folder = fs.mkdtempSync(path.join(local, 'review-fixes-'));
const stamp = '2026-10-21T00:00:00Z', later = '2026-10-21T00:00:01Z';
const user = { id: 2, username: 'audit-reviewer', display_name: 'Audit reviewer', can_review: true };
const record = { id: 10, applicant: 1, applicant_name: 'Owner', stage: 'ecr', status: 'pending', current_review_round: 1, review_mode: 'designated', submitted_at: stamp, created_at: stamp, updated_at: stamp, planned_eco_date: null, title: 'Audit only', ecr_no: 'AUDIT-ONLY', eco_no: '', affected_products: '', affected_region: '', initiating_factory: '', affected_factories: '', ccb_owner: '', change_owner: '', change_reason: '', publisher_id: 1, stage_approver_ids: [1], source_ecr_id: null, source_ecr_no: null, published_by_id: null, published_at: null, publication_request_id: null, eco_creation_request_id: null };
const draft = { ...record, applicant: user.id, status: 'draft', current_review_round: 0, review_mode: '', submitted_at: null, publisher_id: null, stage_approver_ids: [] };
const sourceRecord = { ...draft, stage: 'eco', source_ecr_id: 11, source_ecr_no: 'SOURCE-ECR', ecr_no: '' };
function stageData() {
  return { actor_id: 2, stage: 'ecr', change: record, change_id: 10, updated_at: stamp, status: 'pending', current_round: 1,
    actions: Array.from({ length: 61 }, (_, i) => ({ id: `ecr_${String(i + 1).padStart(3, '0')}`, number: 1, function: 'Audit', text: `Action ${i + 1}`, question_answer: i ? 'N' : 'Y', extra_required: false, required: !i, owner_user_ids: i ? [] : [2], owner_users: i ? [] : [{ id: 2, display_name: user.display_name, is_active: true }], owner_name: i ? '' : user.display_name, owner_active: !i })),
    tasks: [{ id: 1, round: 1, action_key: 'ecr_001', owner_id: 2, owner_name: user.display_name, result: 'Saved result', status: 'completed', date: '2026-10-21', version: 1, confirmed_at: null, can_edit: true, confirmed_requests: [] }], unanswered: [], issue_blockers: [], submission_request_id: null, submission_requests: [] };
}
function snapshot(stage) {
  return { actor_id: 2, change_id: 10, number: 1, snapshot: { version: 1, change_id: 10, number: 1, captured_at: stamp, overview: record, actions: stage.actions, source_overview: null, sheets: { materials: [], questions: { questions: [] }, ecr: {}, eco: {}, emc: {}, execution_plan: {}, significant_change: {} } }, tasks: stage.tasks.map(task => ({ ...task, can_edit: false, confirmed_requests: [] })) };
}
fs.writeFileSync(path.join(folder, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div><script type="module" src="./main.tsx"></script>');
fs.writeFileSync(path.join(folder, 'main.tsx'), `
import React from 'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{App as AntApp}from'antd';
import{StageActions}from'../../src/StageWorkflow';import RoundSnapshotForm from'../../src/RoundSnapshotForm';import MaterialEditor from'../../src/MaterialEditor';import EcrEditor from'../../src/EcrEditor';import App from'../../src/App';
const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:30000,refetchOnWindowFocus:false}}});client.setQueryData(['me'],${JSON.stringify(user)});const noop=()=>{};Object.assign(window,{auditClient:client});
const props={leaving:false,onDirty:noop,onBusy:noop,onBack:noop,onPrevious:noop,onNext:noop,onEditorOpen:noop,onReauthenticate:noop};const mode=location.search;
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><AntApp>{mode.includes('create')?<App/>:mode.includes('source')?<EcrEditor {...props} record={${JSON.stringify(sourceRecord)}}/>:mode.includes('material')?<MaterialEditor {...props} record={${JSON.stringify(draft)}}/>:<><StageActions {...props} record={${JSON.stringify(record)}} onDirty={v=>Object.assign(window,{auditDirty:v})}/>{mode.includes('snapshot')&&<RoundSnapshotForm changeId={10} number={1} expanded/>}</>}</AntApp></QueryClientProvider>);
`);
const base = process.env.REVIEW_BASE_URL || 'http://localhost:5173';
const url = `${base}/.local/${path.basename(folder)}/index.html`;
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const result = {};
  async function pageFor(handler, mode = '') {
    const page = await browser.newPage({ viewport: { width: 1350, height: 1000 } });
    page.on('pageerror', error => { throw error; });
    await page.route('**/api/**', async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname.endsWith('/csrf/')) return route.fulfill({ json: { csrfToken: 'isolated-test-token' } });
      await handler(route, pathname);
    });
    await page.goto(url + '?' + mode); return page;
  }
  try {
    let returned = false, stage = stageData();
    let page = await pageFor((route, pathname) => {
      assert(pathname.endsWith('/stage-workflow/'));
      return route.fulfill({ json: returned ? { ...stage, change: null, actions: [], status: 'returned', updated_at: later, tasks: stage.tasks.map(task => ({ ...task, can_edit: false })) } : stage });
    });
    await page.getByRole('button', { name: '处理任务', exact: true }).click();
    const input = page.getByRole('textbox', { name: '任务评估结果' });
    await input.fill('UNSAVED TEST TEXT'); returned = true;
    await page.evaluate(() => window.auditClient.invalidateQueries({ queryKey: ['stage-workflow'] }));
    assert.equal(await input.inputValue(), 'UNSAVED TEST TEXT'); assert.equal(await input.isEditable(), false);
    assert(await page.evaluate(() => window.auditDirty));
    await page.locator('.ant-drawer-close').click(); await page.locator('.ant-modal-confirm-title').filter({ hasText: '放弃未保存的输入？' }).waitFor();
    result.returnedInput = 'retained, read-only, and explicit discard required'; await page.close();

    stage = stageData(); let snapshotReads = 0;
    page = await pageFor(async (route, pathname) => {
      let body;
      if (pathname.endsWith('/stage-workflow/')) body = stage;
      else if (pathname.includes('/action-tasks/')) {
        const payload = route.request().postDataJSON();
        stage = { ...stage, updated_at: later, tasks: stage.tasks.map(task => ({ ...task, can_edit: false, confirmed_at: later, version: 2, confirmed_requests: [payload.request_id] })) }; body = stage;
      } else { assert(pathname.endsWith('/form-snapshot/')); snapshotReads++; body = snapshot(stage); }
      await route.fulfill({ json: body });
    }, 'snapshot');
    await page.getByRole('heading', { name: '本轮逐人处理结果' }).waitFor();
    await page.getByRole('button', { name: '处理任务', exact: true }).click();
    await page.getByRole('button', { name: '确认任务', exact: true }).click();
    await page.getByRole('button', { name: 'OK', exact: true }).click();
    await page.waitForFunction(() => window.auditClient.getQueryData(['round-form-snapshot', 2, 10, 1])?.tasks[0].confirmed_at !== null);
    const cached = await page.evaluate(() => window.auditClient.getQueryData(['round-form-snapshot', 2, 10, 1]));
    assert.equal(cached.tasks[0].confirmed_at, later); assert(snapshotReads >= 2);
    result.snapshotRefresh = { reads: snapshotReads, confirmedAt: cached.tasks[0].confirmed_at }; await page.close();

    const material = { id: 7, category: 'addition', material_no: '', description: '', material_class: '', spare_part: '', optional_part: '', revision: '', detailed_class: '', old_revision: '', new_revision: '', discontinued_project: '', change_description: '', dispositions: {} };
    let saved, original, posts = 0, patches = 0;
    page = await pageFor(async route => {
      const request = route.request(), method = request.method();
      if (method === 'GET') return route.fulfill({ json: saved ? [saved] : [] });
      const payload = request.postDataJSON();
      if (method === 'POST') {
        posts++;
        if (!saved) { original = payload; saved = { ...material, ...payload }; return route.abort('failed'); }
        assert.deepEqual(payload, original);
      } else { assert.equal(method, 'PATCH'); patches++; saved = { ...saved, ...payload }; }
      return route.fulfill({ json: saved });
    }, 'material');
    await page.getByRole('button', { name: '新增物料', exact: true }).click();
    await page.getByText('新增的物料', { exact: true }).click();
    const description = page.getByRole('textbox', { name: '物料描述／文件标题', exact: true });
    await description.fill('first saved text'); await page.getByRole('button', { name: '保存物料', exact: true }).click();
    await page.getByText(/连接中断/).first().waitFor();
    await description.fill('newer local text'); await page.getByRole('button', { name: '保存物料', exact: true }).click();
    await page.getByText('物料已保存', { exact: true }).waitFor();
    assert.equal(saved.description, 'newer local text'); assert.equal(posts, 2); assert.equal(patches, 1);
    result.materialRecovery = { posts, patches, description: saved.description }; await page.close();

    let created, firstPayload, createPosts = 0;
    page = await pageFor(async (route, pathname) => {
      const request = route.request(); let body;
      if (pathname === '/api/auth/me/') body = user;
      else if (pathname.includes('/inbox/')) body = { actor_id: 2, count: 0, unread_count: 0, items: [] };
      else if (pathname === '/api/engineering-changes/') body = { actor_id: 2, items: [] };
      else if (pathname === '/api/changes/' && request.method() === 'POST') {
        createPosts++; const payload = request.postDataJSON();
        if (!created) { firstPayload = payload; created = { ...draft, creation_request_id: payload.request_id }; return route.abort('failed'); }
        assert.deepEqual(payload, firstPayload); body = created;
      } else if (pathname.endsWith('/publication/')) body = { actor_id: 2, change: created, publisher_name: '', publisher_active: false, can_publish: false, can_create_eco: false, eco_id: null, eco_filler_id: null, eco_creation_receipt: null };
      else if (pathname.endsWith('/stage-navigation/')) body = { actor_id: 2, current_change_id: 10, stages: [{ stage: 'ecr', id: 10, status: 'draft', number: created.ecr_no, current_round: 0, confirmed: 0, total: 0, approved_at: null, published_at: null, updated_at: stamp, can_open: true }, { stage: 'eco', id: null, status: 'not_created', number: null, current_round: null, confirmed: null, total: null, approved_at: null, published_at: null, updated_at: null, can_open: false }] };
      else { assert.equal(pathname, '/api/changes/10/'); body = created; }
      return route.fulfill({ json: body });
    }, 'create');
    await page.getByRole('button', { name: '工程变更', exact: true }).click();
    await page.getByRole('button', { name: /新建ECR/ }).click();
    await page.getByText(/连接中断/).first().waitFor();
    await page.getByRole('button', { name: /新建ECR/ }).click();
    await page.getByRole('heading', { name: /AUDIT-ONLY/ }).waitFor();
    assert.equal(createPosts, 2); assert(firstPayload.request_id);
    result.ecrCreation = { attempts: createPosts, requestIdReused: true }; await page.close();
    const people = [{ id: 2, username: 'first', display_name: 'First', is_active: true }, { id: 3, username: 'second', display_name: 'Second', is_active: true }];
    page = await pageFor((route, pathname) => {
      assert.equal(route.request().method(), 'GET'); assert.equal(pathname, '/api/changes/10/ecr-actions/');
      const actions = Array.from({ length: 61 }, (_, i) => ({ id: `ecr_${String(i + 1).padStart(3, '0')}`, number: 1, function: 'Audit', text: `Action ${i + 1}`, question_answer: i ? 'N' : 'Y', extra_required: false, owner_user_ids: i ? [] : [2, 3], owner_users: i ? [] : people, result: '', status: '', date: null,
        task_results: i ? [] : people.map((owner, index) => ({ id: index + 17, round: 1, owner, result: index ? 'Second result' : 'First result', status: 'completed', date: '2026-10-21', confirmed_at: later })) }));
      return route.fulfill({ json: { updated_at: stamp, source_ecr_id: 11, actions } });
    }, 'source');
    await page.getByRole('button', { name: '查看', exact: true }).first().click();
    const drawer = page.locator('.ant-drawer-body');
    await drawer.getByText('First result', { exact: true }).waitFor(); await drawer.getByText('Second result', { exact: true }).waitFor();
    assert.equal(await drawer.locator('input,textarea').count(), 0);
    result.sourceMultiOwner = 'both published results visible; no edit controls or writes'; await page.close();
    console.log(JSON.stringify(result));
  } finally {
    await browser.close();
    if (!folder.startsWith(local + path.sep)) throw Error('Unexpected harness path');
    for (const name of ['index.html', 'main.tsx']) fs.unlinkSync(path.join(folder, name));
    fs.rmdirSync(folder);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
