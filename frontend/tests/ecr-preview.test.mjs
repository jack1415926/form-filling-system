import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ECR_ACTIONS } from '../src/ecrPreviewData.ts'
import { actionPatch, applyActionPatch, initialActions, initialAnswers, visibleActions, EMPTY_ACTION } from '../src/ecrPreviewState.ts'

test('61 distinct actions preserve repeated source question numbers', () => {
  assert.equal(ECR_ACTIONS.length, 61)
  assert.equal(new Set(ECR_ACTIONS.map(x => x.id)).size, 61)
  assert.deepEqual(ECR_ACTIONS.map(x => x.id), Array.from({ length: 61 }, (_, i) => `ecr_${String(i + 1).padStart(3, '0')}`))
  assert.equal(ECR_ACTIONS.filter(x => x.number === 6).length, 11)
  assert.equal(ECR_ACTIONS.filter(x => x.number === 18).length, 6)
  assert.ok(ECR_ACTIONS.every(x => x.text && x.function && x.number >= 1 && x.number <= 27))
})

test('only triggered actions are visible; saved values remain available in all actions and reappear on trigger', () => {
  const savedAnswers = initialAnswers(), saved = initialActions()
  const draftAnswers = { ...savedAnswers, 6: 'N', 18: 'Y' }
  assert.equal(visibleActions(savedAnswers).length, 11)
  assert.equal(visibleActions(draftAnswers).length, 6)
  assert.equal(visibleActions({ ...savedAnswers, 6: '' }).length, 0)
  assert.equal(visibleActions(savedAnswers, true).length, 61)
  assert.equal(saved.ecr_001.status, 'completed')
  assert.ok(!visibleActions(savedAnswers).some(x => x.number === 1 || x.number === 9))
  assert.ok(visibleActions(savedAnswers, true).some(x => x.id === 'ecr_001'))
  assert.ok(visibleActions({ ...savedAnswers, 1: 'Y' }).some(x => x.id === 'ecr_001'))
  assert.equal(saved.ecr_001.result, '此前填写的演示评估内容，来源问题改为否后仍保留。')
})

test('single-action edits preserve previous saves and unrelated actions', () => {
  const saved = initialActions()
  const single = { ecr_009: { ...EMPTY_ACTION, owner: '演示负责人', result: '第一行\n第二行' } }
  const firstSave = applyActionPatch(saved, actionPatch(saved, single))
  const editSame = applyActionPatch(firstSave, actionPatch(firstSave, { ecr_009: { ...firstSave.ecr_009, status: 'completed' } }))
  const nextSave = applyActionPatch(editSame, actionPatch(editSame, { ecr_010: { ...EMPTY_ACTION, result: '另一个行动' } }))
  assert.equal(nextSave.ecr_009.owner, '演示负责人')
  assert.equal(nextSave.ecr_009.result, '第一行\n第二行')
  assert.equal(nextSave.ecr_009.status, 'completed')
  assert.equal(nextSave.ecr_010.result, '另一个行动')
  assert.deepEqual(nextSave.ecr_001, saved.ecr_001)
  assert.deepEqual(actionPatch(firstSave, single), {})
  assert.deepEqual(initialActions(), saved)
})
