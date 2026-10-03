import assert from 'node:assert/strict'
import { test } from 'node:test'
import reference from '../../backend/changes/emc_reference.json' with { type: 'json' }
import { emcPatch, matrixHeaderGroups, cellKey } from '../src/emcMatrix.ts'

const initial = () => ({ ...structuredClone(reference), cells: {} })
const key = cellKey(reference.rows[0].id, reference.tests[0].id)

test('only changed cell fields are submitted and reverting removes the patch', () => {
  const saved = initial(), values = initial()
  saved.cells[key] = { mark: 'X', remark: '旧说明' }
  values.cells[key] = { mark: 'X', remark: '新说明' }
  values.rows[0].label = '不得提交定义'
  assert.deepEqual(emcPatch(saved, values), { cells: { [key]: { remark: '新说明' } } })
  values.cells[key].remark = '旧说明'
  assert.deepEqual(emcPatch(saved, values), { cells: {} })
})

test('unknown save results retry current values even when reverted or cleared', () => {
  const saved = initial(), values = initial()
  const pending = { cells: { [key]: { mark: 'X', remark: '曾提交' } } }
  assert.deepEqual(emcPatch(saved, values, pending), { cells: { [key]: { mark: '', remark: '' } } })
  values.cells[key] = { mark: '(X)', remark: '当前说明' }
  assert.deepEqual(emcPatch(saved, values, pending), { cells: { [key]: values.cells[key] } })
})

test('clearing a saved cell submits both explicit blanks and keeps unrelated cells', () => {
  const saved = initial(), values = initial()
  saved.cells[key] = { mark: 'X', remark: '旧说明' }
  assert.deepEqual(emcPatch(saved, values), { cells: { [key]: { mark: '', remark: '' } } })
})

test('source headers retain immunity and merged emission groups', () => {
  const groups = matrixHeaderGroups(reference.tests)
  assert.equal(reference.rows.length, 12)
  assert.equal(reference.tests.length, 11)
  assert.deepEqual(groups[0].bands.map((band) => band.label), ['-2', '-3', '-4', '-5', '-6', '-8', '-11'])
  assert.deepEqual(groups[1].bands.map((band) => [band.label, band.tests.length]), [['IEC 1000-3', 2], ['CISPR11', 2]])
})
