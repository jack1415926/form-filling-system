async function openSystemFeedback(page) {
  if (!await page.getByRole('button', { name: '打开系统反馈', exact: true }).isVisible()) await page.getByRole('button', { name: '打开意见与反馈', exact: true }).click();
  await page.getByRole('button', { name: '打开系统反馈', exact: true }).click();
}
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const folder = '.local/system-feedback-browser';
fs.mkdirSync(folder, { recursive: true });
async function checkInputRecovery() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const results = {};
  async function scenario({ roleChange = false, unknownCreate = false, newAccount = false } = {}) {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
    const page = await context.newPage();
    let user = { id: 101, username: 'mock-review-only', display_name: '模拟用户', role: 'filler', can_manage_feedback: false };
    const record = { id: 501, applicant: 101, title: '模拟草稿', ecr_no: 'MOCK', eco_no: '', affected_products: '', affected_region: '', initiating_factory: '', affected_factories: '', ccb_owner: '', change_owner: '', planned_eco_date: null, change_reason: '', status: 'draft', review_mode: '', submitted_at: null, current_review_round: 0, created_at: '2026-10-08T00:00:00Z', updated_at: '2026-10-08T00:00:00Z' };
    const calls = []; let feedback;
    await page.route('**/api/**', async route => {
      const request = route.request(); const path = new URL(request.url()).pathname;
      calls.push({ path, method: request.method() });
      let body = {}, status = 200;
      if (path === '/api/auth/me/') body = user;
      else if (path === '/api/auth/csrf/') body = { csrfToken: 'mock-csrf' };
      else if (path === '/api/auth/login/') { if (roleChange) user = { ...user, role: 'reviewer' }; if (newAccount) user = { ...user, id: 202, username: 'mock-new-account' }; body = { user, csrfToken: 'mock-csrf' }; }
      else if (path === '/api/changes/') body = user.id === 101 ? [record] : [];
      else if (path === '/api/changes/501/') { body = record; if (request.method() === 'PATCH') { status = 400; body = { detail: '模拟校验失败以保留未保存输入' }; } }
      else if (path === '/api/review/') body = [];
      else if (path === '/api/system-feedback/' && request.method() === 'POST') {
        const payload = request.postDataJSON();
        feedback = { ...payload, id: 701, submitter: { id: 101, display_name: '模拟用户' }, status: 'pending', version: 0, created_at: '2026-10-08T00:00:00Z', updated_at: '2026-10-08T00:00:00Z', events: [] };
        if (unknownCreate) { await route.abort('failed'); return; }
        body = feedback; status = 201;
      }
      else if (path.startsWith('/api/system-feedback/requests/')) {
        if (feedback && path.endsWith(feedback.request_id + '/')) body = feedback;
        else { status = 404; body = { detail: '模拟原请求不存在' }; }
      }
      else if (path === '/api/system-feedback/701/') body = feedback;
      else if (path === '/api/system-feedback/') body = { count: feedback ? 1 : 0, next: null, previous: null, results: feedback ? [feedback] : [] };
      else if (path === '/api/review/inbox/') body = { actor_id: user.id, role: user.role, count: 0, unread_count: 0, items: [] };
      else { status = 404; body = { detail: '模拟接口不存在' }; }
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.goto(process.env.FEEDBACK_BASE_URL || 'http://localhost:5173/');
    await page.getByRole('heading', { name: '我的申请', exact: true }).waitFor();
    return { page, context, calls };
  }
  try {
    const first = await scenario(); const p = first.page;
    await p.getByRole('button', { name: '继续填写', exact: true }).click();
    await p.locator('#title').fill('仍未保存的申请标题');
    await p.getByText('模拟校验失败以保留未保存输入', { exact: true }).waitFor();
    await openSystemFeedback(p);
    await p.getByLabel('反馈内容', { exact: true }).fill('取消退出后应仍保留的反馈');
    await p.locator('.ant-drawer-open .ant-drawer-close').click();
    await p.getByRole('button', { name: '退出登录', exact: true }).click();
    await p.getByRole('button', { name: '放弃并离开', exact: true }).click();
    await p.getByText('离开前放弃未保存的修改？', { exact: true }).last().waitFor();
    await p.getByRole('dialog', { name: '离开前放弃未保存的修改？', exact: true }).getByRole('button', { name: '继续填写', exact: true }).click();
    await openSystemFeedback(p);
    results.cancel_final_navigation = { feedback_after_cancel: await p.getByLabel('反馈内容', { exact: true }).inputValue(), application_title: await p.locator('#title').inputValue(), logout_requests: first.calls.filter(call => call.path === '/api/auth/logout/').length };
    await p.screenshot({ path: folder+'/cancel-navigation.png', fullPage: true });
    assert.equal(results.cancel_final_navigation.feedback_after_cancel, '取消退出后应仍保留的反馈');
    assert.equal(results.cancel_final_navigation.logout_requests, 0);
    assert.equal(results.cancel_final_navigation.application_title, '仍未保存的申请标题');
    await p.locator('.ant-drawer-open .ant-drawer-close').click();
    await p.getByRole('button', { name: '返回我的申请', exact: true }).click();
    await p.getByRole('button', { name: '放弃并离开', exact: true }).click();
    await p.getByRole('dialog', { name: '离开前放弃未保存的修改？', exact: true }).getByRole('button', { name: '放弃修改并离开', exact: true }).click();
    await p.getByRole('heading', { name: '我的申请', exact: true }).waitFor();
    await openSystemFeedback(p);
    assert.equal(await p.getByLabel('反馈内容', { exact: true }).inputValue(), '');
    results.confirmed_navigation_discards_feedback = true;
    await first.context.close();

    const second = await scenario({ roleChange: true }); const q = second.page;
    await openSystemFeedback(q);
    await q.getByLabel('反馈内容', { exact: true }).fill('同账号角色变化不应丢失的反馈');
    await q.locator('.ant-drawer-open').getByRole('button', { name: '重新登录', exact: true }).click();
    const modal = q.locator('.ant-modal:visible');
    await modal.getByLabel('用户名', { exact: true }).fill('mock-review-only');
    await modal.getByLabel('密码', { exact: true }).fill('mock-only');
    await modal.getByRole('button', { name: /登\s*录/ }).click();
    await q.getByRole('heading', { name: '审核工作台', exact: true }).waitFor();
    if (!await q.locator('.ant-drawer-open').count()) await openSystemFeedback(q);
    results.same_account_role_change = { id_unchanged: true, feedback_after_login: await q.getByLabel('反馈内容', { exact: true }).inputValue() };
    assert.equal(results.same_account_role_change.feedback_after_login, '同账号角色变化不应丢失的反馈');
    await q.screenshot({ path: folder+'/same-account-role.png', fullPage: true });
    await second.context.close();
    const third = await scenario({ roleChange: true, unknownCreate: true }); const u = third.page;
    await openSystemFeedback(u);
    await u.getByLabel('反馈内容', { exact: true }).fill('未知请求保留原UUID');
    await u.getByRole('button', { name: '提交系统反馈', exact: true }).click();
    await u.getByText('操作结果未确认，原请求和输入已保留', { exact: true }).waitFor();
    await u.locator('.ant-drawer-open').getByRole('button', { name: '重新登录', exact: true }).click();
    const sameAccount = u.locator('.ant-modal:visible');
    await sameAccount.getByLabel('用户名', { exact: true }).fill('mock-review-only');
    await sameAccount.getByLabel('密码', { exact: true }).fill('mock-only');
    await sameAccount.getByRole('button', { name: /登\s*录/ }).click();
    await sameAccount.waitFor({ state: 'hidden' });
    await u.getByText('操作结果未确认，原请求和输入已保留', { exact: true }).waitFor();
    await u.getByRole('button', { name: '查询结果', exact: true }).click();
    await u.getByText('操作结果未确认，原请求和输入已保留', { exact: true }).waitFor({ state: 'hidden' });
    assert.equal(third.calls.filter(call => call.path === '/api/system-feedback/' && call.method === 'POST').length, 1);
    results.role_change_preserves_unknown_request = true;
    await third.context.close();

    const fourth = await scenario({ newAccount: true }); const v = fourth.page;
    await openSystemFeedback(v);
    await v.getByLabel('反馈内容', { exact: true }).fill('旧账号文字不得带入新账号');
    await v.locator('.ant-drawer-open').getByRole('button', { name: '重新登录', exact: true }).click();
    const differentAccount = v.locator('.ant-modal:visible');
    await differentAccount.getByLabel('用户名', { exact: true }).fill('mock-new-account');
    await differentAccount.getByLabel('密码', { exact: true }).fill('mock-only');
    await differentAccount.getByRole('button', { name: /登\s*录/ }).click();
    await differentAccount.waitFor({ state: 'hidden' });
    await openSystemFeedback(v);
    assert.equal(await v.getByLabel('反馈内容', { exact: true }).inputValue(), '');
    results.account_change_clears_feedback = true;
    await fourth.context.close();
    fs.writeFileSync(folder+'/input-recovery.json', JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results));
  } finally { await browser.close(); }
}

async function checkLatePermission() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
  const page = await context.newPage();
  const userA = { id: 101, username: 'mock-a', display_name: '模拟账号A', role: 'filler', can_manage_feedback: true };
  const userB = { ...userA, id: 202, username: 'mock-b', display_name: '模拟账号B' };
  let user = userA, lateA, refreshB;
  try {
    await page.route('**/api/**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      const expected = request.headers()['x-expected-user'];
      if (path === '/api/system-feedback/manage/' && expected === '101') { lateA = route; return; }
      if (path === '/api/auth/me/' && user.id === 202) { refreshB = route; return; }
      let body = {};
      if (path === '/api/auth/me/') body = user;
      else if (path === '/api/auth/csrf/') body = { csrfToken: 'mock-token' };
      else if (path === '/api/auth/login/') { user = userB; body = { user, csrfToken: 'mock-token' }; }
      else if (path === '/api/auth/logout/') body = { detail: '已退出', csrfToken: 'mock-token' };
      else if (path === '/api/changes/') body = [];
      else if (path.startsWith('/api/system-feedback/')) body = { count: 0, next: null, previous: null, results: [] };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.goto(process.env.FEEDBACK_BASE_URL || 'http://localhost:5173/');
    await page.getByRole('heading', { name: '我的申请', exact: true }).waitFor();
    await page.locator('.topbar').getByRole('button', { name: '反馈管理', exact: true }).click();
    while (!lateA) await new Promise(resolve => setTimeout(resolve, 10));
    await page.locator('.ant-drawer-open .ant-drawer-close').click();
    await page.locator('.topbar').getByRole('button', { name: '退出登录', exact: true }).click();
    await page.getByLabel('用户名', { exact: true }).fill('mock-b');
    await page.getByLabel('密码', { exact: true }).fill('mock-only');
    await page.getByRole('button', { name: /登\s*录/ }).click();
    await page.getByText('模拟账号B', { exact: true }).waitFor();
    assert.equal(await page.locator('.topbar').getByRole('button', { name: '反馈管理', exact: true }).count(), 1);
    await page.locator('.topbar').getByRole('button', { name: '反馈管理', exact: true }).click();
    await page.getByRole('columnheader', { name: '提交者', exact: true }).waitFor();
    await page.evaluate(() => window.addEventListener('feedback-permission-changed', event => { window.__feedbackReviewActor = event.detail.expectedUserId; }));
    await lateA.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ detail: '账号A权限已取消', code: 'feedback_permission_changed' }) });
    await page.waitForFunction(() => window.__feedbackReviewActor === 101);
    assert.equal(await page.getByText('反馈管理权限已取消', { exact: true }).count(), 0);
    const result = { current_account: await page.locator('.topbar .user-menu').innerText(), b_manager_button_count: await page.locator('.topbar').getByRole('button', { name: '反馈管理', exact: true }).count(), b_permission_still_true_on_mock_server: user.can_manage_feedback };
    assert.equal(result.b_manager_button_count, 1);
    assert.equal(result.b_permission_still_true_on_mock_server, true);
    fs.writeFileSync('.local/system-feedback-browser/late-permission.json', JSON.stringify(result, null, 2));
    await page.screenshot({ path: '.local/system-feedback-browser/late-permission.png', fullPage: true });
    console.log(JSON.stringify(result));
    if (refreshB) await refreshB.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(userB) });
  } finally { await context.close(); await browser.close(); }
}

(async () => { await checkInputRecovery(); await checkLatePermission(); })().catch(error => { console.error(error); process.exitCode = 1; });
