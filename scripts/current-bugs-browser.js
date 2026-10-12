// Run in an isolated agent-browser page: eval --stdin < this file.
// All API calls are mocked. No real accounts or database writes are used.
(async () => {
  const wait = async (predicate) => {
    for (let i = 0; i < 150; i++) {
      if (predicate()) return;
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    throw new Error('Timed out waiting for the test page');
  };
  const button = text => [...document.querySelectorAll('button')].find(el => [el.textContent, el.getAttribute('aria-label') || ''].some(value => value.replace(/\s/g, '') === text.replace(/\s/g, '')));
  const fill = (input, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  await wait(() => Object.keys(document.getElementById('root')).some(key => key.startsWith('__reactContainer$')));
  const fiber = document.getElementById('root')[Object.keys(document.getElementById('root')).find(key => key.startsWith('__reactContainer$'))];
  const findClient = node => {
    if (!node) return;
    if (node.memoizedProps?.client?.getMutationCache) return node.memoizedProps.client;
    return findClient(node.child) || findClient(node.sibling);
  };
  const client = findClient(fiber.stateNode.current);
  if (!client) throw new Error('React Query client was not found');
  const applicant = { id: 101, username: 'mock-applicant', display_name: '模拟申请者', role: 'filler', can_review: true, can_manage_feedback: false };
  const reviewer = { id: 202, username: 'mock-reviewer', display_name: '模拟审核者' };
  const stamp = '2026-10-12T00:00:00Z';
  const record = { id: 501, applicant: 101, title: '模拟已批准申请', ecr_no: 'MOCK-BUG', eco_no: '', affected_products: '', affected_region: '', initiating_factory: '', affected_factories: '', ccb_owner: '', change_owner: '', planned_eco_date: null, change_reason: '', status: 'approved', review_mode: 'designated', submitted_at: stamp, current_review_round: 2, created_at: stamp, updated_at: stamp };
  const round = { number: 2, title: record.title, ecr_no: record.ecr_no, eco_no: '', review_mode: 'designated', submitted_at: stamp, state: 'approved', approved_at: stamp, returned_at: null, returned_by: null, return_reason: '', reviewers: [reviewer], approvals: [{ ...reviewer, approved_at: stamp }] };
  const oldRound = { ...round, number: 1, state: 'returned', approved_at: null, returned_at: stamp, returned_by: reviewer, return_reason: '模拟第一轮退回原因', approvals: [] };
  const issue = { id: 601, author: reviewer, tab: 'ecr', location: '行动1', text: '模拟跨轮正式意见', source_round: 1, state: 'resolved', version: 3, can_respond: false, can_resolve: false, can_reject: false, events: ['return', 'respond', 'resolve'].map((kind, index) => ({ kind, round_number: index === 0 ? 1 : 2, text: ['模拟提出意见', '模拟修改回应', '模拟确认解决'][index], state: ['awaiting_reply', 'awaiting_review', 'resolved'][index], version: index + 1, author_id: index === 1 ? 101 : 202, request_id: `mock-event-${index}`, created_at: stamp })) };
  const review = { change_id: 501, updated_at: stamp, current_round: 2, round, is_current: true, can_view_form: true, can_approve: false, can_return: false, can_feedback: false, form: record, history: [oldRound, round], feedback: [{ id: 701, round_number: 1, author: reviewer, text: '模拟旧留言保留', request_id: 'mock-feedback', created_at: stamp }], issues: [issue], unresolved_count: 0, issue_blockers: [], confirmed_requests: [] };
  let user = null, rejectLogin = true;
  const requests = [];
  const originalFetch = window.fetch;
  window.fetch = async (url, options = {}) => {
    const path = new URL(url, location.href).pathname;
    if (!path.startsWith('/api/')) return originalFetch(url, options);
    requests.push({ path, method: options.method || 'GET' });
    let status = 200, body;
    if (path === '/api/auth/me/') { body = user || { detail: '请先登录。' }; if (!user) status = 401; }
    else if (path === '/api/auth/csrf/') body = { csrfToken: 'mock-token' };
    else if (path === '/api/auth/login/') {
      if (rejectLogin) { status = 400; body = { detail: '模拟密码错误' }; }
      else { user = applicant; body = { user, csrfToken: 'mock-token' }; }
    } else if (path === '/api/auth/logout/') { user = null; body = { detail: '已退出登录。', csrfToken: 'mock-token' }; }
    else if (path === '/api/changes/') body = [record];
    else if (path === '/api/changes/501/') body = record;
    else if (path === '/api/changes/501/submission/') body = { change: record, reviewers: [reviewer], request_id: null, review_arrangement_locked: false, issue_blockers: [] };
    else if (path === '/api/changes/501/review-rounds/2/') body = review;
    else if (path === '/api/review/inbox/') body = { actor_id: 101, role: 'filler', count: 0, unread_count: 0, items: [] };
    else if (path === '/api/system-feedback/inbox/') body = { unread_count: 0, items: [] };
    else if (path === '/api/system-feedback/') body = { count: 0, next: null, previous: null, results: [] };
    else if (path === '/api/review/') body = [];
    else if (path === '/api/reviewers/') body = [reviewer];
    else { status = 404; body = { detail: 'Unexpected mocked API path' }; }
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  };
  client.removeQueries({ predicate: query => query.queryKey[0] !== 'me' });
  client.setQueryData(['me'], null);
  await wait(() => document.querySelector('#password'));
  const results = {};
  const testPassword = 'synthetic-regression-password';
  fill(document.querySelector('#username'), applicant.username);
  fill(document.querySelector('#password'), testPassword);
  document.querySelector('.ant-input-password-icon').click();
  await wait(() => document.querySelector('#password').type === 'text');
  document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await wait(() => document.body.textContent.includes('模拟密码错误'));
  results.failed_login_password_cleared = document.querySelector('#password').value === '';
  results.failed_login_password_hidden = document.querySelector('#password').type === 'password';
  rejectLogin = false;
  fill(document.querySelector('#password'), testPassword);
  document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await wait(() => button('退出登录'));
  button('重新登录').click();
  await wait(() => document.querySelector('.ant-modal #password'));
  fill(document.querySelector('.ant-modal #username'), applicant.username);
  fill(document.querySelector('.ant-modal #password'), testPassword);
  document.querySelector('.ant-modal form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await wait(() => !document.querySelector('.ant-modal #password'));
  button('退出登录').click();
  await wait(() => document.querySelector('#password'));
  results.logout_input_empty = document.querySelector('#password').value === '';
  results.logout_no_password_in_mutation_cache = !client.getMutationCache().getAll().some(m => m.state.variables?.password === testPassword);
  rejectLogin = false;
  fill(document.querySelector('#username'), applicant.username);
  fill(document.querySelector('#password'), testPassword);
  document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await wait(() => document.querySelector('.workspace-card'));
  [...document.querySelectorAll('.workspace-card')].find(el => el.textContent.includes('我的申请')).click();
  await wait(() => button('查看申请'));
  button('查看申请').click();
  await wait(() => document.querySelector('[role="tab"]'));
  await wait(() => client.getQueryData(['review-round', 101, 501, 2]));
  // React Query notifies the component after its cache receives the response.
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const directHistory = button('查看审核历史与意见');
  results.approved_direct_history_entry = !!directHistory;
  if (directHistory) directHistory.click();
  else { button('打开意见与反馈')?.click(); await wait(() => button('审核意见')); button('审核意见').click(); await wait(() => button('当前申请意见（0）')); button('当前申请意见（0）').click(); }
  await wait(() => document.body.textContent.includes('模拟旧留言保留'));
  results.history_retained = ['模拟跨轮正式意见', '模拟修改回应', '模拟确认解决', '模拟第一轮退回原因', '模拟旧留言保留'].every(text => document.body.textContent.includes(text));
  results.approved_history_read_only = !document.querySelector('.ant-drawer-open textarea');
  document.querySelector('.ant-drawer-open .ant-drawer-close').click();
  [...document.querySelectorAll('[role="tab"]')].find(el => el.textContent === '提交审核').click();
  await wait(() => document.querySelector('.page-heading h1')?.textContent.includes('提交审核'));
  results.submission_tab_history_entry = !!button('查看审核历史与意见');
  if (button('查看审核历史与意见')) {
    button('查看审核历史与意见').click();
    await wait(() => document.querySelector('.ant-drawer-open')?.textContent.includes('模拟旧留言保留'));
  }
  results.no_business_write = !requests.some(r => !r.path.startsWith('/api/auth/') && r.method !== 'GET');
  return { pass: Object.values(results).every(Boolean), results };
})()
