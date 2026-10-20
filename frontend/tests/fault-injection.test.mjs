import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { test } from 'node:test'
import { api } from '../src/api.ts'

const snippet = readFileSync(new URL('../../scripts/browser-fault-injection.js', import.meta.url), 'utf8')
const path = '/api/changes/10/stage-submission/'
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
function install(t, respond = async () => new Response(JSON.stringify({ ok: true }))) {
  const calls = []
  const original = async (input, init) => { calls.push({ input, init }); return respond(input, init) }
  const browser = { fetch: original }
  const context = vm.createContext({ window: browser, location: { href: 'https://test.local/', origin: 'https://test.local' },
    Request, Response, Headers, URL, RegExp, DOMException, ReadableStream, console: { info() {} }, setTimeout, clearTimeout })
  const previous = { fetch: globalThis.fetch, window: globalThis.window, document: globalThis.document }
  t.mock.timers.enable({ apis: ['setTimeout'] })
  // Resolve timer functions after Node installs its test clock.
  context.setTimeout = setTimeout; context.clearTimeout = clearTimeout
  vm.runInContext(snippet, context)
  globalThis.window = new EventTarget(); globalThis.document = { cookie: 'csrftoken=test' }
  globalThis.fetch = (...args) => browser.fetch(...args)
  t.after(() => { browser.ecFault.restore(); for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value } })
  return { browser, fault: browser.ecFault, calls, reinstall: () => vm.runInContext(snippet, context) }
}

test('fault HTTP defaults exercise application status messages; explicit field errors survive', async t => {
  const { fault, calls } = install(t)
  for (const [status, message] of [[400, '请求内容有误'], [403, '没有此操作权限'], [404, '记录不存在'], [409, '流程状态已变化'], [429, '过于频繁'], [500, '结果未确认']]) {
    fault.clear(); fault.add({ url: path, method: 'POST', mode: 'http', status })
    await assert.rejects(api(path, 'POST', {}, 1), error => error.status === status && error.message.includes(message))
  }
  fault.clear(); fault.add({ url: path, method: 'POST', mode: 'http', status: 400, body: { title: ['模拟字段错误'] } })
  await assert.rejects(api(path, 'POST', {}, 1), /标题：模拟字段错误/)
  assert.equal(calls.length, 0)
})

test('POST fault persists across retries, leaves GET untouched, and clear does not replay a write', async t => {
  const { fault, calls } = install(t)
  fault.add({ url: path, method: 'POST', mode: 'network' })
  for (let i = 0; i < 2; i++) await assert.rejects(api(path, 'POST', {}, 1), /连接中断/)
  await api('/api/changes/10/stage-workflow/')
  assert.equal(calls.length, 1)
  fault.clear(); assert.equal(calls.length, 1)
  await api(path, 'POST', {}, 1); assert.equal(calls.length, 2)
  assert.deepEqual(Array.from(fault.history(), row => row.forwarded), [false, false])
})

test('all three hanging modes obey the real API deadline; clear leaves in-flight faults and restore cancels them', async t => {
  for (const mode of ['timeout', 'body-timeout', 'after-timeout']) await t.test(mode, async t => {
    const { fault, calls } = install(t)
    fault.add({ url: path, method: 'POST', mode, ...(mode.startsWith('after-') ? { forward: true } : {}) })
    const pending = assert.rejects(api(path, 'POST', {}, 1), /超时/)
    await flush(); fault.clear(); t.mock.timers.tick(30_000); await pending
    assert.equal(calls.length, mode === 'after-timeout' ? 1 : 0)
  })
})

test('restore cancels a hanging request and removes rules without sending it', async t => {
  const { fault, calls } = install(t)
  fault.add({ url: path, method: 'POST', mode: 'timeout' })
  const pending = assert.rejects(api(path, 'POST', {}, 1), /连接中断/)
  await flush(); fault.restore(); await pending
  assert.equal(calls.length, 0)
  await api(path, 'POST', {}, 1); assert.equal(calls.length, 1)
  assert.throws(() => fault.add({ url: path }), /已撤销/)
})

test('after-network forwards once then loses success, preserves real rejections, and requires explicit write authorization', async t => {
  let status = 200
  const { fault, calls } = install(t, async () => new Response(JSON.stringify({ detail: '实际业务拒绝' }), { status }))
  assert.throws(() => fault.add({ url: path, method: 'POST', mode: 'after-network' }), /forward:true/)
  assert.throws(() => fault.add({ url: path, method: 'POST', mode: 'delay' }), /forward:true/)
  fault.add({ url: path, method: 'POST', mode: 'after-network', forward: true })
  await assert.rejects(api(path, 'POST', {}, 1), /连接中断/); assert.equal(calls.length, 1)
  status = 409
  await assert.rejects(api(path, 'POST', {}, 1), /实际业务拒绝/); assert.equal(calls.length, 2)
  assert(fault.history().every(row => row.forwarded))
})

test('JSON corruption is local, GET patch forwards and preserves status, and patch refuses writes', async t => {
  const { fault, calls } = install(t)
  for (const mode of ['invalid-json', 'json']) {
    fault.clear(); fault.add({ url: path, mode })
    if (mode === 'invalid-json') await assert.rejects(api(path), /格式异常/)
    else assert.deepEqual(await api(path), {})
  }
  assert.equal(calls.length, 0)
  fault.clear(); fault.add({ url: path, mode: 'patch', edit: data => ({ ...data, patched: true }) })
  assert.deepEqual(await api(path), { ok: true, patched: true }); assert.equal(calls.length, 1)
  assert.throws(() => fault.add({ url: path, method: 'PATCH', mode: 'patch', edit: data => data }), /仅用于GET/)
})

test('matching distinguishes path, query, method, origin and API namespace; regex and fragments remain usable', async t => {
  const { fault, calls } = install(t)
  fault.add({ url: '/api/changes/10/', mode: 'network' })
  await assert.rejects(api('/api/changes/10/'), /连接/)
  for (const url of ['/api/changes/10/questions/', '/other', 'https://external.local/api/changes/10/']) await api(url)
  await api('/api/changes/10/', 'POST', {}, 1)
  assert.equal(calls.length, 4)
  fault.clear(); fault.add({ url: '/api/publications/?state=approved', mode: 'network' })
  await assert.rejects(api('/api/publications/?state=approved'), /连接/)
  await api('/api/publications/?state=published')
  fault.clear(); fault.add({ url: /stage-workflow/g, mode: 'network' })
  for (let i = 0; i < 2; i++) await assert.rejects(api('/api/changes/10/stage-workflow/'), /连接/)
  fault.clear(); fault.add({ url: 'questions', mode: 'network' })
  await assert.rejects(api('/api/changes/10/questions/'), /连接/)
})

test('delay aborts before forwarding and reinstall removes old rules without stacking fetch wrappers', async t => {
  const { fault, calls, reinstall, browser } = install(t)
  fault.add({ url: path, mode: 'delay', ms: 35_000 })
  const pending = assert.rejects(api(path), /超时/)
  await flush(); t.mock.timers.tick(30_000); await pending
  assert.equal(calls.length, 0)
  reinstall(); assert.equal(browser.ecFault.status().length, 0)
  await api(path); assert.equal(calls.length, 1)
})
