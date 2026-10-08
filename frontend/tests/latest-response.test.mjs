import assert from 'node:assert/strict'
import { test } from 'node:test'
import { newestResponse } from '../src/latestResponse.ts'

test('an old PATCH response keeps the newer GET snapshot and application timestamp', () => {
  const read = { updated_at: '2026-10-02T12:02:00Z', owner: '负责人B' }
  const saved = { updated_at: '2026-10-02T12:01:00Z', owner: '原负责人' }
  assert.equal(newestResponse(read, saved), read)
  assert.equal(newestResponse(saved, read), read)
  const detail = { updated_at: '2026-10-02T20:02:00+08:00', title: '申请' }
  assert.equal(newestResponse(detail, { ...detail, updated_at: saved.updated_at }), detail)
})

test('responses within the same millisecond still preserve the newer snapshot', () => {
  const newer = { updated_at: '2026-10-02T12:00:00.123456+00:00', owner: '新值' }
  const older = { updated_at: '2026-10-02T20:00:00.123455+08:00', owner: '旧值' }
  assert.equal(newestResponse(newer, older), newer)
  assert.equal(newestResponse(older, newer), newer)
})

test('first responses and equal timestamps remain usable', () => {
  const response = { updated_at: '2026-10-02T12:00:00Z' }
  assert.equal(newestResponse(undefined, response), response)
  assert.equal(newestResponse(response, response), response)
})
