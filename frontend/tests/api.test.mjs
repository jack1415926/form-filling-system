import assert from 'node:assert/strict'
import { test } from 'node:test'
import { api, ApiError, formatApiErrors } from '../src/api.ts'

test('nested validation errors retain field paths and messages', () => {
  assert.deepEqual(formatApiErrors({ dispositions: { company_finished: { disposition: ['非法选项'], remark: ['备注错误'] } } }), [
    'dispositions.company_finished.disposition：非法选项',
    'dispositions.company_finished.remark：备注错误',
  ])
  assert.deepEqual(formatApiErrors({ detail: '请求失败' }), ['请求失败'])
})

const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
test('role rejection refreshes identity and retains the permission message instead of a login error', async (t) => {
  mockEnvironment(t, async () => new Response(JSON.stringify({ detail: '当前账号为审核员，不能访问填写员功能。', code: 'role_forbidden' }), { status: 403 }))
  let changed = 0
  window.addEventListener('role-changed', () => changed++)
  await assert.rejects(api('/api/changes/'), (error) => error.status === 403 && error.message === '当前账号为审核员，不能访问填写员功能。')
  assert.equal(changed, 1)
})

function mockEnvironment(t, fetcher, cookie = 'csrftoken=test-csrf') {
  const previous = { fetch: globalThis.fetch, document: globalThis.document, window: globalThis.window }
  globalThis.fetch = fetcher; globalThis.document = { cookie }; globalThis.window = new EventTarget()
  t.mock.timers.enable({ apis: ['setTimeout'] })
  t.after(() => { globalThis.fetch = previous.fetch; if (previous.document === undefined) delete globalThis.document; else globalThis.document = previous.document; if (previous.window === undefined) delete globalThis.window; else globalThis.window = previous.window })
}

test('30-second GET deadline rejects even if transport ignores cancellation', async (t) => {
  let signal, finished = false
  mockEnvironment(t, (_url, init) => { signal = init.signal; return new Promise(() => {}) })
  const pending = assert.rejects(api('/mock/read/').finally(() => { finished = true }), (error) => error instanceof ApiError && error.status === 0 && error.message.includes('读取超时'))
  t.mock.timers.tick(29_999); await settle(); assert.equal(finished, false)
  t.mock.timers.tick(1); await pending; assert.equal(signal.aborted, true)
})

test('deadline includes a stalled JSON response body and releases manual save lock', async (t) => {
  mockEnvironment(t, async () => ({ status: 200, ok: true, json: () => new Promise(() => {}) }))
  const { Autosave } = await import('../src/autosave.ts')
  const queue = new Autosave({ title: 'old' }, (patch) => api('/mock/write/', 'PATCH', patch, 7), () => {})
  queue.configure(false, true, false); queue.update({ title: 'preserve' })
  const pending = assert.rejects(queue.flush(), (error) => error.status === 0 && error.message.includes('结果未确认'))
  await settle(); t.mock.timers.tick(30_000); await pending
  assert.equal(queue.pending, false); assert.equal(queue.manual, false); assert.equal(queue.values.title, 'preserve'); assert(queue.unconfirmed.has('title')); queue.dispose()
})

test('CSRF acquisition and the write share one total deadline and abort signal', async (t) => {
  let csrfRelease
  const calls = []
  mockEnvironment(t, (url, init) => { calls.push({ url, signal: init.signal }); return url.includes('/csrf/') ? new Promise((resolve) => { csrfRelease = resolve }) : new Promise(() => {}) }, '')
  const pending = assert.rejects(api('/mock/write/', 'PATCH', {}, 7), (error) => error.status === 0 && error.message.includes('结果未确认'))
  t.mock.timers.tick(20_000); csrfRelease(new Response(JSON.stringify({ csrfToken: 'new-token' }))); await settle()
  assert.equal(calls.length, 2); assert.equal(calls[0].signal, calls[1].signal)
  t.mock.timers.tick(10_000); await pending; assert.equal(calls[1].signal.aborted, true)
})

test('stalled CSRF times out without sending the write; late responses cannot trigger account changes', async (t) => {
  let release, changes = 0, calls = 0
  mockEnvironment(t, () => { calls++; return new Promise((resolve) => { release = resolve }) }, '')
  globalThis.window.addEventListener('account-changed', () => changes++)
  const pending = assert.rejects(api('/mock/write/', 'PATCH', {}, 7), (error) => error.status === 0)
  t.mock.timers.tick(30_000); await pending
  release(new Response(JSON.stringify({ code: 'account_changed', detail: 'late' }), { status: 409 })); await settle()
  assert.equal(calls, 1); assert.equal(changes, 0)
})

test('completed requests clear their deadline and preserve normal list/DELETE responses', async (t) => {
  const signals = []
  mockEnvironment(t, async (_url, init) => { signals.push(init.signal); return init.method === 'DELETE' ? new Response(null, { status: 204 }) : new Response(JSON.stringify([{ id: 1 }])) })
  assert.deepEqual(await api('/mock/list/'), [{ id: 1 }]); assert.equal(await api('/mock/row/', 'DELETE', undefined, 7), undefined)
  t.mock.timers.tick(90_000); assert(signals.every((signal) => !signal.aborted))
})

test('requests bind expected account and display nested errors', async () => {
  const previous = { fetch: globalThis.fetch, document: globalThis.document, window: globalThis.window }
  globalThis.document = { cookie: 'csrftoken=test-csrf' }
  globalThis.window = new EventTarget()
  let changed = 0
  globalThis.window.addEventListener('account-changed', () => changed++)
  try {
    globalThis.fetch = async (_path, options) => {
      assert.equal(options.headers['X-Expected-User'], '7')
      assert.equal(options.headers['X-CSRFToken'], 'test-csrf')
      return new Response(JSON.stringify({ dispositions: { company_finished: { disposition: ['非法选项'] } } }), { status: 400 })
    }
    await assert.rejects(api('/api/changes/1/materials/2/', 'PATCH', {}, 7), (error) => error instanceof ApiError && error.message === 'dispositions.company_finished.disposition：非法选项')
    assert.equal(changed, 0)
    globalThis.fetch = async () => new Response(JSON.stringify({ detail: '账号已变化', code: 'account_changed' }), { status: 409 })
    await assert.rejects(api('/api/changes/', 'POST', {}, 7), (error) => error.status === 409 && error.message === '账号已变化')
    assert.equal(changed, 1)
  } finally {
    globalThis.fetch = previous.fetch
    if (previous.document === undefined) delete globalThis.document
    else globalThis.document = previous.document
    if (previous.window === undefined) delete globalThis.window
    else globalThis.window = previous.window
  }
})
