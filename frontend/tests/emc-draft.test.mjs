import assert from 'node:assert/strict'
import { test } from 'node:test'
import reference from '../../backend/changes/emc_reference.json' with { type: 'json' }
import { matrixHeaderGroups } from '../src/emcMatrix.ts'

test('source headers retain immunity and merged emission groups', () => {
  const groups = matrixHeaderGroups(reference.tests)
  assert.equal(reference.rows.length, 12)
  assert.equal(reference.tests.length, 11)
  assert.deepEqual(groups[0].bands.map((band) => band.label), ['-2', '-3', '-4', '-5', '-6', '-8', '-11'])
  assert.deepEqual(groups[1].bands.map((band) => [band.label, band.tests.length]), [['IEC 1000-3', 2], ['CISPR11', 2]])
})
