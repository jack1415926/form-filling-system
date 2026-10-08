import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dateError } from '../src/dateValidation.ts'
import { Autosave } from '../src/autosave.ts'

test('business dates distinguish incomplete, nonexistent and out-of-range dates including leap years', () => {
  for (const value of ['', '2000-01-01', '2100-12-31', '2000-02-29', '2024-02-29', '2026-09-30']) assert.equal(dateError(value), null, value)
  for (const value of ['2026-', '2026-09-', '2026-09-3']) assert.match(dateError(value), /未填写完整/, value)
  for (const value of ['2026-09-31', '2026-02-29', '2100-02-29', '2026-00-01', '2026-13-01', '2026-01-00']) assert.match(dateError(value), /不存在/, value)
  for (const value of ['1999-12-31', '2101-01-01', '9999-01-01']) assert.match(dateError(value), /2000～2100/, value)
  assert.match(dateError('2026/09/30'), /格式不正确/)
})

test('invalid date edits block saving without replacing the baseline; explicit clearing can save null', async () => {
  const baseline = { date: '2026-09-30', owner: 'Original' }
  let payload
  const queue = new Autosave(baseline, async (patch) => { payload = patch; return { ...baseline, ...patch } }, () => {})
  queue.configure(false, false, false)
  queue.update({ owner: 'Edited' })
  await assert.rejects(queue.flush())
  assert.equal(payload, undefined)
  assert.equal(queue.values.date, baseline.date)
  queue.update({ date: null }); queue.configure(false, true, false)
  await queue.flush()
  assert.deepEqual(payload, { date: null, owner: 'Edited' })
  queue.dispose()
})
