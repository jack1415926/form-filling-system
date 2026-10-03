import assert from 'node:assert/strict'
import { test } from 'node:test'
import { executionPlanFields, executionPlanPayload, invalidPlanRows } from '../src/executionPlanDraft.ts'
import { Autosave } from '../src/autosave.ts'

test('stable activity keys preserve fields and explicit date/text clearing in PATCH', () => {
  const data = { rows: [{ id: 'plan_011', activity: '里程碑 9', owner: '', start_date: null, end_date: null, remark: '' }] }
  assert.deepEqual(executionPlanFields(data), { 'plan_011.owner': '', 'plan_011.start_date': null, 'plan_011.end_date': null, 'plan_011.remark': '' })
  assert.deepEqual(executionPlanPayload({ 'plan_011.end_date': null, 'plan_001.remark': '' }), { responses: { plan_011: { end_date: null }, plan_001: { remark: '' } } })
})

test('same dates and one-sided dates are valid; multiple incomplete/order errors remain independently protected', () => {
  const rows = [{ id: 'plan_001' }, { id: 'plan_002' }]
  const values = { 'plan_001.start_date': '2026-10-03', 'plan_001.end_date': '2026-10-03', 'plan_002.end_date': '2026-10-01' }
  assert.deepEqual(invalidPlanRows(values, rows), [])
  assert.deepEqual(invalidPlanRows({ ...values, 'plan_001.end_date': '2026-10-02' }, rows, new Set(['plan_002.start_date'])), ['plan_001', 'plan_002'])
  assert.deepEqual(invalidPlanRows(values, rows, new Set(['plan_002.start_date', 'plan_002.end_date'])), ['plan_002'])
  assert.deepEqual(invalidPlanRows(values, rows, new Set(['plan_002.end_date'])), ['plan_002'])
})

test('plan differences omit reverted fields while an acknowledged in-flight date edit remains dirty', async () => {
  const baseline = { 'plan_001.owner': 'original', 'plan_001.start_date': null, 'plan_001.end_date': null, 'plan_001.remark': '' }
  let release
  const queue = new Autosave(baseline, () => new Promise((resolve) => { release = resolve }), () => {})
  queue.configure(false, true, false)
  queue.update({ 'plan_001.owner': 'temporary' }); queue.update({ 'plan_001.owner': 'original', 'plan_001.start_date': '2026-10-03' })
  assert.deepEqual(queue.patch, { 'plan_001.start_date': '2026-10-03' })
  const saving = queue.flush()
  queue.update({ 'plan_001.start_date': null })
  release({ ...baseline, 'plan_001.start_date': '2026-10-03' }); await saving
  assert.deepEqual(executionPlanPayload(queue.patch), { responses: { plan_001: { start_date: null } } })
  queue.dispose()
})

test('response merging can expose a date conflict; validate the current merged draft before another save', async () => {
  const rows = [{ id: 'plan_001' }]
  const baseline = { 'plan_001.start_date': '2026-10-03', 'plan_001.end_date': '2026-10-10', 'plan_001.owner': '' }
  let release
  const queue = new Autosave(baseline, () => new Promise((resolve) => { release = resolve }), () => {})
  queue.configure(false, true, false); queue.update({ 'plan_001.owner': 'owner' })
  const saving = queue.flush(); queue.update({ 'plan_001.start_date': '2026-10-07' })
  release({ ...baseline, 'plan_001.owner': 'owner', 'plan_001.end_date': '2026-10-05' }); await saving
  assert.deepEqual(invalidPlanRows(queue.values, rows), ['plan_001'])
  queue.configure(false, false, false); await assert.rejects(queue.flush()); queue.dispose()
})
