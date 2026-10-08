const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const folder = '.local/system-feedback-browser';
const fixture = JSON.parse(fs.readFileSync(folder + '/fixture.json', 'utf8'));
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const results = {}, contexts = [], errors = [];
  let lastPage;
  async function login(account) {
    const context = await browser.newContext({ baseURL: process.env.FEEDBACK_BASE_URL || 'http://localhost:5173', viewport: { width: 1600, height: 1100 } });
    contexts.push(context);
    const page = await context.newPage(); lastPage = page;
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    await page.getByLabel('用户名', { exact: true }).fill(account.username);
    await page.getByLabel('密码', { exact: true }).fill(account.password);
    await page.getByRole('button', { name: /登\s*录/ }).click();
    await page.getByRole('heading', { name: account.kind === 'reviewer' ? '审核工作台' : '我的申请', exact: true }).waitFor();
    return page;
  }
  async function select(page, label, text) {
    await page.getByLabel(label, { exact: true }).click();
    await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: text }).first().click();
  }
  const unknown = page => page.getByText('操作结果未确认，原请求和输入已保留', { exact: true });
  try {
    const owner = await login(fixture.accounts[0]);
    await owner.getByRole('button', { name: '继续填写', exact: true }).click();
    await owner.locator('#title').fill('反馈期间保留的申请标题');
    await owner.getByRole('button', { name: '打开系统反馈', exact: true }).click();
    await owner.getByLabel('反馈内容', { exact: true }).fill('回归问题：保存后页面体验需要改善');
    let refreshDialogs = 0;
    owner.once('dialog', async dialog => { refreshDialogs++; await dialog.dismiss(); });
    await owner.reload({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
    assert.equal(refreshDialogs, 1);
    assert.equal(await owner.getByLabel('反馈内容', { exact: true }).inputValue(), '回归问题：保存后页面体验需要改善');
    results.refresh_protection = true;
    // A second session invalidates this one; reauthenticate in place without losing the draft.
    await login(fixture.accounts[0]);
    lastPage = owner;
    await owner.getByRole('button', { name: /提交系统反馈/ }).click();
    await owner.getByText('登录已失效或尚未登录，请重新登录。未保存的填写内容仍保留。', { exact: true }).waitFor();
    await owner.locator('.ant-drawer-open').getByRole('button', { name: '重新登录', exact: true }).click();
    const loginModal = owner.locator('.ant-modal:visible');
    await loginModal.getByLabel('用户名', { exact: true }).fill(fixture.accounts[0].username);
    await loginModal.getByLabel('密码', { exact: true }).fill(fixture.accounts[0].password);
    await loginModal.getByRole('button', { name: /登\s*录/ }).click();
    await loginModal.waitFor({ state: 'hidden' });
    assert.equal(await owner.getByLabel('反馈内容', { exact: true }).inputValue(), '回归问题：保存后页面体验需要改善');
    results.same_account_reauthentication_preserves_draft = true;
    let lostCreate = false, created;
    await owner.route('**/api/system-feedback/', async route => {
      if (route.request().method() === 'POST' && !lostCreate) {
        lostCreate = true;
        const response = await route.fetch(); created = await response.json();
        assert.equal(response.status(), 201);
        await route.abort('failed');
      } else await route.continue();
    });
    await owner.getByRole('button', { name: /提交系统反馈/ }).click();
    await unknown(owner).waitFor();
    await owner.route('**/api/system-feedback/requests/*/', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'controlled query failure' }) }));
    await owner.getByRole('button', { name: '查询结果', exact: true }).click();
    await owner.getByText('controlled query failure', { exact: true }).waitFor();
    assert.equal(await unknown(owner).count(), 1);
    await owner.unroute('**/api/system-feedback/requests/*/');
    await owner.getByRole('button', { name: '按原请求重试', exact: true }).click();
    await unknown(owner).waitFor({ state: 'hidden' });
    await owner.getByRole('heading', { name: /反馈 #/ }).waitFor();
    assert.equal((await owner.evaluate(async () => (await fetch('/api/system-feedback/')).json())).count, 1);
    results.create_lost_response_idempotent_retry = true;
    await owner.locator('.ant-drawer-open .ant-drawer-close').click();
    assert.equal(await owner.locator('#title').inputValue(), '反馈期间保留的申请标题');
    results.application_editor_preserved = true;

    const admin = await login(fixture.accounts[2]);
    await admin.getByRole('button', { name: '继续填写', exact: true }).click();
    await admin.route('**/api/changes/'+fixture.records[2]+'/', route => route.request().method() === 'PATCH' ? route.abort('failed') : route.continue());
    await admin.locator('#title').fill('撤销反馈管理权限仍须保留的填写草稿');
    await admin.getByRole('button', { name: '反馈管理', exact: true }).click();
    await admin.getByRole('button', { name: new RegExp('#' + created.id + ' ·') }).click();
    await select(admin, '处理状态', '处理中');
    let lostAction = false;
    await admin.route('**/api/system-feedback/manage/*/actions/', async route => {
      if (!lostAction) { lostAction = true; const response = await route.fetch(); assert.equal(response.status(), 200); await route.abort('failed'); }
      else await route.continue();
    });
    await admin.locator('.ant-drawer-open button').filter({ hasText: '保存处理记录' }).click();
    await unknown(admin).waitFor();
    await admin.getByRole('button', { name: '查询结果', exact: true }).click();
    await unknown(admin).waitFor({ state: 'hidden' });
    results.admin_lost_response_query = true;
    await select(admin, '处理状态', '已关闭');
    assert.equal(await admin.locator('.ant-drawer-open button').filter({ hasText: '保存处理记录' }).isDisabled(), true);
    await admin.getByLabel('管理员处理说明', { exact: true }).fill('已处理；暂不采用建议的原因也会在这里说明。');
    await admin.locator('.ant-drawer-open button').filter({ hasText: '保存处理记录' }).click();
    await admin.getByLabel('管理员处理说明', { exact: true }).waitFor();
    await admin.waitForFunction(() => document.querySelector('[aria-label="管理员处理说明"]').value === '');
    await select(admin, '处理状态', '处理中');
    await admin.getByLabel('管理员处理说明', { exact: true }).fill('重新打开，继续核对。');
    await admin.locator('.ant-drawer-open button').filter({ hasText: '保存处理记录' }).click();
    await admin.waitForFunction(() => document.querySelector('[aria-label="管理员处理说明"]').value === '');
    results.close_reopen_history = true;
    await admin.screenshot({ path: folder + '/admin-history.png', fullPage: true });

    const other = await login(fixture.accounts[3]);
    const isolation = await other.evaluate(async id => ({ mine: (await fetch('/api/system-feedback/'+id+'/')).status, manage: (await fetch('/api/system-feedback/manage/')).status }), created.id);
    assert.deepEqual(isolation, { mine: 404, manage: 403 });
    results.cross_user_and_admin_isolation = true;

    const reviewer = await login(fixture.accounts[1]);
    await reviewer.getByRole('button', { name: '查看申请', exact: true }).click();
    await reviewer.getByRole('button', { name: '列出修改意见并退回', exact: true }).click();
    await reviewer.getByLabel('意见1具体问题', { exact: true }).fill('审核意见文字仍保留');
    await reviewer.locator('.ant-drawer-open').getByRole('button', { name: '系统反馈', exact: true }).click();
    await reviewer.getByRole('button', { name: '保留并切换', exact: true }).click();
    await reviewer.getByLabel('反馈内容', { exact: true }).fill('审核员也可反馈系统问题');
    await reviewer.locator('.ant-drawer-open').getByRole('button', { name: '审核修改意见', exact: true }).click();
    await reviewer.getByRole('button', { name: '保留并切换', exact: true }).click();
    assert.equal(await reviewer.getByLabel('意见1具体问题', { exact: true }).inputValue(), '审核意见文字仍保留');
    assert.equal(await reviewer.locator('.ant-drawer-open').count(), 1);
    await reviewer.locator('.ant-drawer-open').getByRole('button', { name: '系统反馈', exact: true }).click();
    await reviewer.getByRole('button', { name: '保留并切换', exact: true }).click();
    assert.equal(await reviewer.getByLabel('反馈内容', { exact: true }).inputValue(), '审核员也可反馈系统问题');
    await reviewer.getByRole('button', { name: /提交系统反馈/ }).click();
    await reviewer.getByRole('heading', { name: /反馈 #/ }).waitFor();
    results.reviewer_submit_and_drawer_coordination = true;

    // Both drafts must survive cancelling the final reviewer logout confirmation.
    await reviewer.getByRole('tab', { name: '提交反馈', exact: true }).click();
    await reviewer.getByLabel('反馈内容', { exact: true }).fill('审核员取消退出后保留的系统反馈');
    await reviewer.locator('.ant-drawer-open .ant-drawer-close').click();
    await reviewer.locator('.topbar').getByRole('button', { name: '退出登录', exact: true }).click();
    await reviewer.getByRole('button', { name: '放弃并离开', exact: true }).click();
    await reviewer.getByRole('dialog', { name: '离开未发送的审核意见？', exact: true }).getByRole('button', { name: /取\s*消/ }).click();
    await reviewer.getByRole('button', { name: '打开系统反馈', exact: true }).click();
    assert.equal(await reviewer.getByLabel('反馈内容', { exact: true }).inputValue(), '审核员取消退出后保留的系统反馈');
    await reviewer.locator('.ant-drawer-open').getByRole('button', { name: '审核修改意见', exact: true }).click();
    await reviewer.getByRole('button', { name: '保留并切换', exact: true }).click();
    assert.equal(await reviewer.getByLabel('意见1具体问题', { exact: true }).inputValue(), '审核意见文字仍保留');
    results.reviewer_cancel_logout_preserves_both_drafts = true;

    // A committed response is lost, then the administrator's capability is removed.
    await admin.unroute('**/api/system-feedback/manage/*/actions/');
    await admin.getByLabel('管理员处理说明', { exact: true }).fill('权限撤销前实际已保存的回应');
    await admin.route('**/api/system-feedback/manage/*/actions/', async route => { const response = await route.fetch(); assert.equal(response.status(), 200); await route.abort('failed'); });
    await admin.locator('.ant-drawer-open button').filter({ hasText: '保存处理记录' }).click();
    await unknown(admin).waitFor();
    execFileSync(process.env.FEEDBACK_POWERSHELL, ['-NoProfile', '-File', process.env.FEEDBACK_BACKEND_SCRIPT, 'shell', '-c', "exec(open('../scripts/system_feedback_fixture.py', encoding='utf-8-sig').read())"], { env: { ...process.env, FEEDBACK_FIXTURE_ACTION: 'revoke' }, stdio: 'pipe' });
    await admin.getByRole('button', { name: '查询结果', exact: true }).click();
    await admin.getByText('反馈管理权限已取消', { exact: true }).waitFor();
    assert.equal(await admin.getByRole('heading', { name: '回复与更新状态', exact: true }).count(), 0);
    await admin.getByRole('button', { name: '放弃输入并返回我的反馈', exact: true }).click();
    await admin.getByRole('button', { name: '放弃并离开', exact: true }).click();
    await unknown(admin).waitFor({ state: 'hidden' });
    assert.equal(await admin.locator('.topbar').getByRole('button', { name: '反馈管理', exact: true }).count(), 0);
    assert.equal(await admin.locator('#title').inputValue(), '撤销反馈管理权限仍须保留的填写草稿');
    results.revocation_releases_unknown_with_explicit_discard = true;
    results.revocation_preserves_unrelated_application_input = true;
    await owner.getByRole('button', { name: '打开系统反馈', exact: true }).click();
    await owner.getByRole('button', { name: '刷新反馈', exact: true }).click();
    await owner.getByText('权限撤销前实际已保存的回应', { exact: true }).waitFor();
    await owner.screenshot({ path: folder + '/owner-history.png', fullPage: true });
    const final = await owner.evaluate(async id => (await fetch('/api/system-feedback/'+id+'/')).json(), created.id);
    assert.equal(final.events.length, 4);
    assert.equal(final.content, created.content);
    results.owner_sees_all_public_history = true;
    assert.deepEqual(errors, []);
    fs.writeFileSync(folder + '/verification.json', JSON.stringify({ results, browser_errors: errors }, null, 2));
    console.log(JSON.stringify(results));
  } catch (error) {
    if (lastPage) {
      await lastPage.screenshot({ path: folder + '/failure.png', fullPage: true }).catch(() => {});
      fs.writeFileSync(folder+'/failure.txt', await lastPage.locator('body').innerText().catch(() => ''));
      fs.writeFileSync(folder+'/failure.html', await lastPage.content().catch(() => ''));
      fs.writeFileSync(folder+'/failure-accessibility.txt', await lastPage.locator('body').ariaSnapshot().catch(() => ''));
    }
    throw error;
  } finally {
    for (const context of contexts) await context.close();
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
