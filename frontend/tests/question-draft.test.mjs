import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ApiError } from '../src/api.ts'
import { saveResultUnconfirmed } from '../src/questionDraft.ts'

test('only ambiguous failures require confirmation, including unreadable success responses', () => {
  for (const status of [0, 200, 502, 500]) assert.equal(saveResultUnconfirmed(new ApiError(status, '错误')), true)
  for (const status of [400, 401, 403, 404, 405, 409]) assert.equal(saveResultUnconfirmed(new ApiError(status, '拒绝')), false)
  assert.equal(saveResultUnconfirmed(new Error('未知请求结果')), true)
})
