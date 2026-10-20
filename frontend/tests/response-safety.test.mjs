import assert from 'node:assert/strict'
import { test } from 'node:test'
import { QueryClient } from '@tanstack/react-query'
import { checkedQuestions } from '../src/questionDraft.ts'
import { checkedPlan } from '../src/executionPlanDraft.ts'
import { checkedEmc } from '../src/emcMatrix.ts'
import { checkedMaterials } from '../src/materialSave.ts'
import { Autosave } from '../src/autosave.ts'
const stamp = '2026-10-20T01:00:00Z'
const questions = { updated_at: stamp, questions: Array.from({ length: 27 }, (_, n) => ({ number: n + 1, function: '', text: '', answer: 'N', remark: '', remark_hint: null })) }
const plan = { updated_at: stamp, rows: Array.from({ length: 11 }, (_, n) => ({ id: `plan_${String(n + 1).padStart(3, '0')}`, activity: '', owner: '', start_date: null, end_date: null, remark: '' })) }
const emc = { updated_at: stamp, initialized: false, can_fill: true, title: '', introduction: '', legend: '', definitions: '', rows: [{ id: 'r1', label: '' }], tests: [{ id: 't1', label: '', group: '', standard: '' }], cells: {} }
const material = { id: 1, category: 'revision', material_no: '', description: '', material_class: '', old_revision: '', new_revision: '', revision: '', detailed_class: '', discontinued_project: '', change_description: '', spare_part: '', optional_part: '', dispositions: {} }

test('malformed successful reads become query errors and retain the previous usable cache', async () => {
  for (const [check, valid, invalid] of [
    [checkedQuestions, questions, [null, {}, [], { ...questions, questions: [] }, { ...questions, questions: questions.questions.slice(1) }, { ...questions, questions: questions.questions.map(row => ({ ...row, number: 1 })) }, { ...questions, updated_at: 'invalid' }, { ...questions, questions: questions.questions.map(row => ({ ...row, remark: null })) }]],
    [checkedPlan, plan, [{}, [], { ...plan, rows: [] }, { ...plan, rows: plan.rows.map(row => ({ ...row, id: 'plan_001' })) }, { ...plan, rows: plan.rows.map(row => ({ ...row, start_date: 'invalid' })) }]],
    [checkedEmc, emc, [{}, [], { ...emc, rows: null }, { ...emc, tests: [] }, { ...emc, cells: { 'foreign/t1': { mark: '', remark: '' } } }, { ...emc, cells: { 'r1/t1': { mark: 'Y', remark: '' } } }]],
    [checkedMaterials, [material], [{}, null, [material, material], [{ ...material, category: 'foreign' }], [{ ...material, description: null }]]],
  ]) {
    assert.equal(check(valid), valid)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }), key = ['read']
    client.setQueryData(key, valid)
    for (const value of invalid) {
      await assert.rejects(client.fetchQuery({ queryKey: key, queryFn: async () => check(value) }))
      assert.equal(client.getQueryData(key), valid)
    }
    client.clear()
  }
  assert.deepEqual(checkedMaterials([]), []) // A real empty material list is legitimate.
  assert.equal(checkedEmc({ ...emc, initialized: true, cells: { 'r1/t1': { mark: '(X)', remark: 'saved' } } }).cells['r1/t1'].mark, '(X)')
})

test('a partial 200 save cannot clear pending fields or replace a validated cache', async () => {
  const client = new QueryClient(), key = ['questions']
  client.setQueryData(key, questions)
  const queue = new Autosave({ remark: 'original' }, async () => {
    const result = checkedQuestions({ ...questions, questions: [] })
    client.setQueryData(key, result)
    return { remark: 'overwritten' }
  }, () => {})
  queue.configure(false, true, false); queue.update({ remark: 'keep this text' })
  await assert.rejects(queue.flush())
  assert.equal(queue.values.remark, 'keep this text'); assert.equal(queue.dirty, true)
  assert.equal(queue.unconfirmed.has('remark'), true); assert.equal(client.getQueryData(key), questions)
  queue.dispose(); client.clear()
})
