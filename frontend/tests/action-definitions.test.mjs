import assert from 'node:assert/strict'
import { test } from 'node:test'
import actions from '../../backend/changes/ecr_actions.json' with { type: 'json' }

const ECR_ACTIONS=actions

test('61 distinct actions preserve repeated source question numbers', () => {
  assert.equal(ECR_ACTIONS.length, 61)
  assert.equal(new Set(ECR_ACTIONS.map(x => x.id)).size, 61)
  assert.deepEqual(ECR_ACTIONS.map(x => x.id), Array.from({ length: 61 }, (_, i) => `ecr_${String(i + 1).padStart(3, '0')}`))
  assert.equal(ECR_ACTIONS.filter(x => x.number === 6).length, 11)
  assert.equal(ECR_ACTIONS.filter(x => x.number === 18).length, 6)
  assert.ok(ECR_ACTIONS.every(x => x.text && x.function && x.number >= 1 && x.number <= 27))
})

