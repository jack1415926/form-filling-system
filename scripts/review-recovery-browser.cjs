const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const folder = '.local/review-recovery-browser';
(async () => {
  const fixture = JSON.parse(fs.readFileSync(folder + '/fixture.json', 'utf8'));
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const results = {};
  const contexts = [];
  async function login(account) {
    const context = await browser.newContext({ baseURL: process.env.REVIEW_BASE_URL || 'http://localhost:5173', viewport: { width: 1600, height: 1000 } });
    contexts.push(context);
    const page = await context.newPage();
    await page.goto('/');
    await page.getByLabel('用户名', { exact: true }).fill(account.username);
    await page.getByLabel('密码', { exact: true }).fill(account.password);
    await page.getByRole('button', { name: /登\s*录/ }).click();
    await page.getByRole('heading', { name: account.role === 'filler' ? '我的申请' : '审核工作台', exact: true }).waitFor();
    return { context, page };
  }
  try {
    const reviewer = await login(fixture.accounts[1]);
    const reviewPage = reviewer.page;
    await reviewPage.getByRole('button', { name: '查看申请', exact: true }).click();
    await reviewPage.getByRole('heading', { name: /第1轮审核/ }).waitFor();
    const unloadPrevented = () => reviewPage.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
    assert.equal(await unloadPrevented(), false);
    await reviewPage.getByRole('button', { name: '列出修改意见并退回', exact: true }).click();
    await reviewPage.getByRole('textbox', { name: '意见1具体问题', exact: true }).fill('尚未提交的重要意见');
    results.unloadProtection = await reviewPage.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return { defaultPrevented: event.defaultPrevented };
    });
    let dialogs = 0;
    reviewPage.on('dialog', async dialog => { dialogs++; await dialog.dismiss(); });
    await reviewPage.screenshot({ path: folder + '/fixed-reviewer-unsent-before.png', fullPage: true });
    await reviewPage.reload().catch(error => { if (!dialogs) throw error; });
    results.unloadProtection.dialogsOnReload = dialogs;
    results.unloadProtection.textAfterReload = await reviewPage.getByRole('textbox', { name: '意见1具体问题', exact: true }).inputValue();
    assert.equal(results.unloadProtection.defaultPrevented, true);
    assert.equal(dialogs, 1);
    assert.equal(results.unloadProtection.textAfterReload, '尚未提交的重要意见');
    await reviewPage.screenshot({ path: folder + '/fixed-reviewer-unsent-after.png', fullPage: true });
    // Cancel the unsent draft and use the same real reviewer session for the second scenario.
    await reviewPage.getByRole('button', { name: '删除未提交意见', exact: true }).click();
    await reviewPage.waitForFunction(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return !event.defaultPrevented; });
    await reviewPage.locator('.ant-drawer-close').click();
    await reviewPage.route(`**/api/changes/${fixture.records[0]}/review-rounds/1/approve/`, async route => {
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      await route.abort('failed');
    });
    await reviewPage.getByRole('button', { name: '通过本轮', exact: true }).click();
    await reviewPage.getByRole('button', { name: '确认通过', exact: true }).click();
    await reviewPage.getByText('操作结果未确认，原请求及输入已保留', { exact: true }).waitFor();
    results.unknownReviewProtected = await unloadPrevented();
    assert.equal(results.unknownReviewProtected, true);
    await reviewPage.getByRole('button', { name: '查询结果', exact: true }).click();
    await reviewPage.getByText('操作结果未确认，原请求及输入已保留', { exact: true }).waitFor({ state: 'hidden' });
    await reviewPage.waitForFunction(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return !event.defaultPrevented; });
    results.confirmedReviewClean = true;

    const filler = await login(fixture.accounts[0]);
    const page = filler.page;
    await page.getByRole('button', { name: '全项目复查2（临时）', exact: true }).click();
    await page.getByRole('tab', { name: '提交审核', exact: true }).click();
    await page.getByRole('radio', { name: '公开审核', exact: true }).check();
    let submitted;
    await page.route(`**/api/changes/${fixture.records[1]}/submission/`, async route => {
      if (route.request().method() !== 'POST') return route.continue();
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      submitted = await response.json();
      const token = (await (await reviewer.context.request.get('/api/auth/csrf/')).json()).csrfToken;
      const returned = await reviewer.context.request.post(`/api/changes/${fixture.records[1]}/review-rounds/1/return/`, {
        headers: { 'X-CSRFToken': token, 'X-Expected-User': String(fixture.accounts[1].id) },
        data: { request_id: crypto.randomUUID(), issues: [{ tab: 'overview', text: '独立临时复查意见' }] },
      });
      assert.equal(returned.status(), 200);
      await route.abort('failed');
    });
    await page.getByRole('button', { name: '提交申请', exact: true }).click();
    await page.getByRole('button', { name: '确认提交并锁定', exact: true }).click();
    await page.getByText('提交结果未确认', { exact: true }).waitFor();
    const submissionPattern = `**/api/changes/${fixture.records[1]}/submission/`;
    const failedQuery = route => route.request().method() === 'GET'
      ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: '临时查询失败' }) })
      : route.fallback();
    await page.route(submissionPattern, failedQuery);
    await page.getByRole('button', { name: /查询提交结果/ }).click();
    await page.getByText('临时查询失败', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '上一页', exact: true }).isDisabled(), true);
    results.failedQueryProtected = true;
    await page.unroute(submissionPattern, failedQuery);
    const mismatchedQuery = async route => {
      if (route.request().method() !== 'GET') return route.fallback();
      const response = await route.fetch();
      const data = await response.json();
      data.request_id = crypto.randomUUID();
      await route.fulfill({ response, json: data });
    };
    await page.route(submissionPattern, mismatchedQuery);
    await page.getByRole('button', { name: /查询提交结果/ }).click();
    await page.getByText('暂未查到新一轮提交完成；结果仍待确认，请按原请求重试。', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '上一页', exact: true }).isDisabled(), true);
    results.mismatchedQueryProtected = true;
    await page.unroute(submissionPattern, mismatchedQuery);
    const loaded = page.waitForResponse(r => r.url().endsWith(`/api/changes/${fixture.records[1]}/submission/`) && r.request().method() === 'GET');
    await page.getByRole('button', { name: /查询提交结果/ }).click();
    const confirmed = await (await loaded).json();
    await page.getByText('提交结果未确认', { exact: true }).waitFor({ state: 'hidden' });
    await page.waitForFunction(() => !Array.from(document.querySelectorAll('button')).find(button => button.textContent?.replace(/\s/g, '') === '上一页')?.disabled);
    results.returnedSubmission = {
      serverStatus: confirmed.change.status,
      serverRound: confirmed.change.current_review_round,
      originalRequestConfirmed: confirmed.request_id === submitted.request_id,
      unknownBannerStillVisible: await page.getByText('提交结果未确认', { exact: true }).isVisible(),
      previousButtonDisabled: await page.getByRole('button', { name: '上一页', exact: true }).isDisabled(),
    };
    assert.equal(results.returnedSubmission.originalRequestConfirmed, true);
    assert.equal(results.returnedSubmission.unknownBannerStillVisible, false);
    assert.equal(results.returnedSubmission.previousButtonDisabled, false);
    await page.getByRole('button', { name: '上一页', exact: true }).click();
    await page.getByRole('heading', { name: '实质性变更评估', exact: true }).waitFor();
    results.returnedEditingRestored = true;
    await page.screenshot({ path: folder + '/fixed-returned-editing.png', fullPage: true });
    fs.writeFileSync(folder + '/fix-verification.json', JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
  } finally {
    for (const context of contexts) await context.close();
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
