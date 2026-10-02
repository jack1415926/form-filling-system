import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ApiError } from '../src/api.ts'
import { questionPatch, saveResultUnconfirmed } from '../src/questionDraft.ts'

const baseline = { updated_at: '2026-10-02T00:00:00Z', questions: [
  { number: 1, answer: '', remark: '' },
  { number: 2, answer: 'Y', remark: '其他题保留' },
] }
const values = (fields) => ({ ...baseline, questions: baseline.questions.map((row) => ({ ...row, ...(fields[row.number] ?? {}) })) })

test('ordinary edits submit only changed fields and reverting removes the patch', () => {
  assert.deepEqual(questionPatch(baseline, values({ 1: { remark: '输入' } })), { 1: { remark: '输入' } })
  assert.deepEqual(questionPatch(baseline, values({ 1: { remark: '' } })), {})
})

test('after commit with lost response reverting still submits an explicit clear', () => {
  const submitted = questionPatch(baseline, values({ 1: { remark: '服务端可能已保存' } }))
  const simulatedServer = values({ 1: { remark: '服务端可能已保存' } })
  const retry = questionPatch(baseline, values({ 1: { remark: '' } }), submitted)
  assert.deepEqual(retry, { 1: { remark: '' } })
  Object.assign(simulatedServer.questions[0], retry[1])
  assert.equal(simulatedServer.questions[0].remark, '')
  assert.deepEqual(simulatedServer.questions[1], baseline.questions[1])
  assert.deepEqual(questionPatch(simulatedServer, simulatedServer), {})
})

test('uncertain fields retain current values without replaying stale payloads or unrelated fields', () => {
  const unconfirmed = { 1: { answer: 'Y', remark: '旧输入' }, 2: { remark: '旧备注' } }
  assert.deepEqual(questionPatch(baseline, values({ 1: { remark: '重试新输入' } }), unconfirmed), {
    1: { answer: '', remark: '重试新输入' }, 2: { remark: '其他题保留' },
  })
})

test('only ambiguous failures require confirmation, including unreadable success responses', () => {
  for (const status of [0, 200, 502, 500]) assert.equal(saveResultUnconfirmed(new ApiError(status, '错误')), true)
  for (const status of [400, 401, 403, 404, 405, 409]) assert.equal(saveResultUnconfirmed(new ApiError(status, '拒绝')), false)
  assert.equal(saveResultUnconfirmed(new Error('未知请求结果')), true)
})
