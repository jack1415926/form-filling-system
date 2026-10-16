import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkedChange, checkedReviewers } from '../src/submission.ts'

test('change responses validate current ECR/ECO identity, metadata and approver IDs', () => {
  const stamp = '2026-10-16T00:00:00Z'
  const change = { id: 1, applicant: 4, stage: 'ecr', current_review_round: 0, title: '', ecr_no: '', eco_no: '',
    affected_products: '', affected_region: '', initiating_factory: '', affected_factories: '', ccb_owner: '', change_owner: '',
    planned_eco_date: null, change_reason: '', status: 'draft', review_mode: '', submitted_at: null, created_at: stamp, updated_at: stamp }
  assert.equal(checkedChange(change, { id: 1, applicant: 4 }), change)
  const eco = { ...change, stage: 'eco', stage_approver_ids: [2, 3] }
  assert.equal(checkedChange(eco, { id: 1 }), eco)
  for (const patch of [{ id: 9 }, { applicant: 0 }, { current_review_round: -1 }, { status: 'unknown' }, { review_mode: undefined },
    { submitted_at: undefined }, { updated_at: 'invalid' }, { change_reason: null }, { stage_approver_ids: [2, 2] }, { stage_approver_ids: [true] }]) {
    assert.throws(() => checkedChange({ ...change, ...patch }, { id: 1 }))
  }
  assert.throws(() => checkedChange(change, { id: 1, applicant: 9 }))
})

test('people lists validate identity, types and uniqueness', () => {
  const people = [{ id: 2, username: 'owner', display_name: 'Owner' }]
  assert.deepEqual(checkedReviewers(people), people)
  for (const value of [{}, null, [{}], [people[0], people[0]], [{ ...people[0], id: -1 }], [{ ...people[0], username: null }]]) {
    assert.throws(() => checkedReviewers(value))
  }
})
