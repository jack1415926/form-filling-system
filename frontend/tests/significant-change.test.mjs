import assert from 'node:assert/strict'
import { test } from 'node:test'
import { significantFields, significantPayload, subResult, needsConclusionReview } from '../src/significantChangeDraft.ts'
import { Autosave } from '../src/autosave.ts'
import { ApiError } from '../src/api.ts'
import definition from '../../backend/changes/significant_change.json' with { type: 'json' }
import { QueryClient } from '@tanstack/react-query'

const data = {
  ...structuredClone(definition), updated_at: '2026-10-04T10:00:00.123456Z',
  assessment: { f_assessment: '', final_conclusion: 'significant' },
  charts: definition.charts.map((row) => ({ ...row, applicability: row.id === 'B' ? 'Y' : '', reason: '', result: row.id === 'B' ? 'continue' : '' })),
  questions: definition.questions.map((row) => ({ ...row, answer: row.id === 'sub_b_1_1' ? 'Y' : '', reason: row.id === 'sub_b_1_1' ? 'before' : '' })),
}

test('decimal display numbers use dot-free stable keys and sparse clearing spans all three sections', () => {
  const fields = significantFields(data)
  assert.equal(fields['sub_b_1_1.answer'], 'Y'); assert.equal(fields['chart_B.result'], 'continue')
  assert.equal('chart_0.result' in fields, false)
  assert.deepEqual(significantPayload({ 'sub_b_1_1.answer': '', 'chart_B.result': '', 'assessment.final_conclusion': '' }), { questions: { sub_b_1_1: { answer: '' } }, charts: { B: { result: '' } }, assessment: { final_conclusion: '' } })
})

test('branch hints have no result for unanswered and do not overwrite manual conclusions', () => {
  const row = data.questions.find((row) => row.id === 'sub_b_1_1')
  assert.equal(subResult(row, ''), ''); assert.equal(subResult(row, 'N'), row.no_result); assert.equal(subResult(row, 'Y'), row.yes_result)
  const values = significantFields(data)
  assert.equal(needsConclusionReview(values, { 'sub_b_1_1.answer': 'N' }), true)
  assert.equal(needsConclusionReview(values, { 'chart_B.applicability': 'N' }), true)
  assert.equal(needsConclusionReview(values, { 'sub_b_1_1.reason': 'before' }), false)
  assert.equal(needsConclusionReview(values, { 'chart_B.result': 'significant' }), false)
  assert.equal(values['assessment.final_conclusion'], 'significant'); assert.equal(values['chart_B.result'], 'continue')
})

test('incomplete success responses cannot erase confirmed rows or manual conclusion fields', () => {
  const expected = significantFields(data)
  assert.throws(() => significantFields({ ...data, assessment: {} }, expected))
  assert.throws(() => significantFields({ ...data, questions: [] }, expected))
  assert.throws(() => significantFields({ ...data, questions: data.questions.map((row, index) => index === 0 ? { ...row, reason: null } : row) }, expected))
  assert.deepEqual(significantFields(data, expected), expected)
})

test('cold responses must contain unique fixed IDs, correct question groups and required metadata', () => {
  for (const invalid of [
    null, [], { ...data, charts: [], questions: [] }, { ...data, charts: data.charts.slice(1) },
    { ...data, charts: data.charts.map((row, index) => index === 0 ? data.charts[1] : row) },
    { ...data, questions: data.questions.slice(1) },
    { ...data, questions: data.questions.map((row, index) => index === 0 ? data.questions[1] : row) },
    { ...data, questions: data.questions.map((row, index) => index === 0 ? { ...row, id: 'sub_unknown' } : row) },
    { ...data, questions: data.questions.map((row, index) => index === 0 ? { ...row, chart: 'B' } : row) },
    { ...data, updated_at: undefined }, { ...data, updated_at: 'invalid' }, { ...data, final_options: null },
    { ...data, charts: data.charts.map((row, index) => index === 0 ? { ...row, next_steps: null } : row) },
  ]) assert.throws(() => significantFields(invalid), /评估响应不完整/)
  assert.deepEqual(significantFields({ ...data, charts: [...data.charts].reverse(), questions: [...data.questions].reverse() }), significantFields(data))
})

test('rejected cold GET does not poison the query cache and a normal retry restores the complete form', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  const queryKey = ['significant-change', 1, 1]
  let response = { ...data, charts: [], questions: [] }
  const read = () => client.fetchQuery({ queryKey, queryFn: async () => {
    const previous = client.getQueryData(queryKey)
    significantFields(response, previous && significantFields(previous))
    return response
  } })
  try {
    await assert.rejects(read(), /评估响应不完整/)
    assert.equal(client.getQueryData(queryKey), undefined)
    response = data
    assert.equal(await read(), data)
    assert.equal(client.getQueryData(queryKey).questions.length, 37)
    assert.equal(Object.keys(significantFields(client.getQueryData(queryKey))).length, 93)
    response = { ...data, questions: [] }
    await assert.rejects(read(), /评估响应不完整/)
    assert.equal(client.getQueryData(queryKey), data)
  } finally { client.clear() }
})

test('assessment payload retains later answer and manual result edits while the queue is in flight', async () => {
  const baseline = significantFields(data)
  let release
  const queue = new Autosave(baseline, () => new Promise((resolve) => { release = resolve }), () => {})
  queue.configure(false, true, false); queue.update({ 'sub_b_1_1.reason': 'sent' })
  const saving = queue.flush()
  queue.update({ 'sub_b_1_1.reason': 'later', 'chart_B.result': 'significant' })
  release({ ...baseline, 'sub_b_1_1.reason': 'sent' }); await saving
  assert.deepEqual(significantPayload(queue.patch), { charts: { B: { result: 'significant' } }, questions: { sub_b_1_1: { reason: 'later' } } })
  queue.dispose()
})

test('an unconfirmed save retains a clear even if the user reverts to the old baseline', async () => {
  const baseline = significantFields(data)
  const queue = new Autosave(baseline, async () => { throw new ApiError(0, 'unknown') }, () => {})
  queue.configure(false, true, false); queue.update({ 'assessment.f_assessment': 'ra_significant' })
  await assert.rejects(queue.flush())
  queue.update({ 'assessment.f_assessment': '' })
  assert.deepEqual(significantPayload(queue.patch), { assessment: { f_assessment: '' } })
  queue.dispose()
})
