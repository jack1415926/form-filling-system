import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatApiErrors } from '../src/api.ts'
import { currentStageIndex } from '../src/stageNavigationData.ts'
import { canOpenSubchart } from '../src/significantChangeDraft.ts'

test('validation names use business labels', () => {
  assert.deepEqual(formatApiErrors({ eco_no: ['提交前必须填写。'] }), ['ECO编号：提交前必须填写。'])
})
test('the current opened stage selects its own step', () => {
  assert.equal(currentStageIndex({ stage: 'eco', status: 'draft' }), 3)
  assert.equal(currentStageIndex({ stage: 'eco', status: 'pending' }), 4)
  assert.equal(currentStageIndex({ stage: 'eco', status: 'approved' }), 5)
  assert.equal(currentStageIndex({ stage: 'ecr', status: 'draft' }), 0)
})
test('only applicable subcharts can open', () => {
  assert.equal(canOpenSubchart('Y'), true)
  for (const value of ['', 'N', undefined]) assert.equal(canOpenSubchart(value), false)
})
