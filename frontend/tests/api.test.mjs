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
