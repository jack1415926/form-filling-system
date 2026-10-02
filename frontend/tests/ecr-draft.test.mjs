import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createEcrDraft, refreshEcrDraft } from '../src/ecrDraft.ts'

const original = { id: 'ecr_001', number: 1, function: '研发', text: '行动', question_answer: 'Y', owner: '旧负责人', result: '旧结果', status: '', date: null }
const latest = { ...original, owner: '新负责人', result: '新结果', status: 'completed', date: '2026-10-02' }

test('a clean refresh synchronizes all fields and the saved baseline', () => {
  const refreshed = refreshEcrDraft(createEcrDraft(original), latest, false, false, false)
  assert.equal(refreshed.baseline, latest)
  assert.deepEqual(refreshed.values, { owner: '新负责人', result: '新结果', status: 'completed', date: '2026-10-02' })
  assert.equal(refreshEcrDraft(refreshed, latest, false, false, false), refreshed)
})

test('dirty reads preserve input and its baseline until the edits are reverted', () => {
  const initial = createEcrDraft(original)
  const editing = { ...initial, values: { ...initial.values, result: '未保存输入' } }
  assert.equal(refreshEcrDraft(editing, latest, true, false, false), editing)
  assert.equal(editing.baseline.result, '旧结果')
  assert.equal(editing.values.result, '未保存输入')
  const reverted = { ...editing, values: initial.values }
  assert.equal(refreshEcrDraft(reverted, latest, false, false, false).values.result, '新结果')
})

test('pending or unconfirmed saves protect values even when dirty has not propagated', () => {
  const originalDraft = createEcrDraft(original)
  assert.equal(refreshEcrDraft(originalDraft, latest, false, true, false), originalDraft)
  assert.equal(refreshEcrDraft(originalDraft, latest, false, false, true), originalDraft)
})
