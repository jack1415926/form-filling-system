import assert from 'node:assert/strict'
import { test } from 'node:test'
import { newestResponse, refreshBaseline } from '../src/latestResponse.ts'

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

test('a read deferred during editing is adopted after reverting without another fetch', () => {
  const baseline = { updated_at: '2026-10-03T00:00:00Z', answer: 'Y', remark: '旧备注' }
  const fetched = { updated_at: '2026-10-03T00:01:00Z', answer: 'N', remark: '新备注' }
  assert.equal(refreshBaseline(baseline, fetched, true), baseline)
  assert.equal(refreshBaseline(baseline, fetched, false), fetched)
})

test('protected drafts keep their baseline; clean forms reject older sub-millisecond reads', () => {
  const baseline = { updated_at: '2026-10-03T00:00:00.123456Z', title: '新标题' }
  const older = { updated_at: '2026-10-03T00:00:00.123455Z', title: '旧标题' }
  const newer = { updated_at: '2026-10-03T00:00:00.123457Z', title: '最新标题' }
  assert.equal(refreshBaseline(baseline, newer, true), baseline)
  assert.equal(refreshBaseline(baseline, older, false), baseline)
  assert.equal(refreshBaseline(baseline, newer, false), newer)
  assert.equal(refreshBaseline(baseline, baseline, false), baseline)
})
