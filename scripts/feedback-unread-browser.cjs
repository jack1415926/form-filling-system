const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const folder = '.local/system-feedback-browser';
fs.mkdirSync(folder, { recursive: true });

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const results = {};
  try {
    for (const managed of [false, true]) {
      const context = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      let updated = false, readVersion = 1, detailReads = 0;
      const owner = { id: 101, display_name: '模拟填写员' }, manager = { id: 102, display_name: '模拟反馈管理员' };
      const actor = managed ? manager : owner;
      const oldEvent = { id: 1, actor: managed ? owner : manager, kind: managed ? 'followup' : 'manager', text: '已读的旧消息',
        from_status: 'pending', to_status: managed ? 'pending' : 'processing', base_version: 0, request_id: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb', created_at: '2026-10-09T00:01:00Z' };
      const ownEvent = { ...oldEvent, id: 2, actor, kind: managed ? 'manager' : 'followup', text: '本人发送的内容', from_status: oldEvent.to_status, to_status: 'processing', base_version: 1, request_id: 'cccccccc-cccc-4ccc-cccc-cccccccccccc' };
      const newEvent = { ...oldEvent, id: 3, text: managed ? '新追加意见' : '新管理员回复', from_status: 'processing', to_status: 'processing', base_version: 2, request_id: 'dddddddd-dddd-4ddd-dddd-dddddddddddd' };
      const data = () => ({ id: 901, submitter: owner, category: 'problem', content: '定位具体未读消息', status: updated ? 'processing' : oldEvent.to_status,
        request_id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', version: updated ? 3 : 1, created_at: '2026-10-09T00:00:00Z', updated_at: '2026-10-09T00:03:00Z', events: updated ? [oldEvent, ownEvent, newEvent] : [oldEvent] });
      const inbox = () => ({ unread_count: updated && readVersion < 3 ? 1 : 0,
        items: updated && readVersion < 3 ? [{ id: 901, message_version: 3, read_version: readVersion, content: data().content, status: data().status, managed }] : [] });
      await page.route('**/api/**', async route => {
        const request = route.request(), path = new URL(request.url()).pathname;
        let body;
        if (path === '/api/auth/me/') body = { ...actor, username: 'mock-unread', role: 'filler', can_manage_feedback: managed };
        else if (path === '/api/auth/csrf/') body = { csrfToken: 'mock-token' };
        else if (path === '/api/changes/') body = [];
        else if (path === '/api/review/inbox/') body = { actor_id: actor.id, role: 'filler', count: 0, unread_count: 0, items: [] };
        else if (path === '/api/system-feedback/inbox/') body = inbox();
        else if (path === '/api/system-feedback/inbox/read/') { assert.deepEqual(request.postDataJSON(), { id: 901, message_version: 3 }); readVersion = 3; body = inbox(); }
        else if (path === `/api/system-feedback/${managed ? 'manage/' : ''}901/`) { detailReads++; body = data(); }
        else if (path === `/api/system-feedback/${managed ? 'manage/' : ''}`) body = { count: 1, next: null, previous: null, results: [data()] };
        else { await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ detail: 'Unknown mock endpoint' }) }); return; }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      });
      try {
        await page.goto(process.env.FEEDBACK_BASE_URL || 'http://localhost:5173');
        await page.getByRole('heading', { name: '我的申请', exact: true }).waitFor();
        if (managed) await page.locator('.topbar').getByRole('button', { name: '反馈管理', exact: true }).click();
        else {
          await page.getByRole('button', { name: '打开意见与反馈', exact: true }).click();
          await page.getByRole('button', { name: '打开系统反馈', exact: true }).click();
          await page.getByRole('tab', { name: /^我的反馈/ }).click();
        }
        await page.getByRole('button', { name: /^#901 ·/ }).click();
        await page.getByText('已读的旧消息', { exact: true }).waitFor();
        const before = detailReads;
        const textarea = page.getByLabel(managed ? '管理员处理说明' : '追问或追加意见', { exact: true });
        await textarea.fill('刷新应保留的未发送草稿');
        updated = true;
        const received = page.waitForResponse(response => new URL(response.url()).pathname === '/api/system-feedback/inbox/');
        await page.locator('.ant-drawer-open button').filter({ hasText: '刷新提醒' }).click();
        await received;
        await page.getByRole('button', { name: /^查看 #901 ·/ }).click();
        await page.getByText(newEvent.text, { exact: true }).waitFor();
        assert.ok(detailReads > before);
        assert.equal(await textarea.inputValue(), '刷新应保留的未发送草稿');
        const notes = page.locator('.feedback-unread-note');
        assert.equal(await notes.count(), 1);
        assert.ok((await notes.innerText()).includes(newEvent.text));
        assert.equal(await notes.getByText('已读的旧消息', { exact: true }).count(), 0);
        assert.equal(await notes.getByText('本人发送的内容', { exact: true }).count(), 0);
        await page.screenshot({ path: `${folder}/unread-${managed ? 'manager' : 'owner'}-detail.png`, fullPage: true });
        await page.getByRole('button', { name: managed ? '清除处理草稿' : '清除追加草稿', exact: true }).click();
        await page.getByRole('button', { name: '返回反馈列表', exact: true }).click();
        const row = page.locator('.ant-table-tbody tr').filter({ hasText: '#901' });
        assert.equal(await row.getByText('未读', { exact: true }).count(), 1);
        await page.locator('.ant-table-wrapper .ant-spin-spinning').waitFor({ state: 'hidden' });
        await page.locator('.ant-table-wrapper .ant-spin-spinning').waitFor({ state: 'hidden' });
        await page.screenshot({ path: `${folder}/unread-${managed ? 'manager' : 'owner'}-list.png`, fullPage: true });
        await page.getByRole('button', { name: /^#901 ·/ }).click();
        await page.locator('.ant-drawer-open button').filter({ hasText: '标为已读' }).click();
        await notes.waitFor({ state: 'hidden' });
        await page.getByRole('button', { name: '返回反馈列表', exact: true }).click();
        assert.equal(await row.getByText('无未读', { exact: true }).count(), 1);
        assert.deepEqual(errors, []);
        results[managed ? 'manager' : 'owner'] = { same_feedback_refreshed: true, draft_preserved: true, unread_list_row: true, only_new_incoming_event_highlighted: true, marking_clears_row_and_event: true };
      } finally { await context.close(); }
    }
    fs.writeFileSync(`${folder}/unread-verification.json`, JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
