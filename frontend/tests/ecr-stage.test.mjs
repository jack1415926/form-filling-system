import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkedStage } from '../src/ecrStage.ts'

const task = { id: 1, round: 1, action_key: 'ecr_001', owner_id: 2, owner_name: 'Owner', result: 'History', status: 'completed', date: '2026-10-12', version: 2, confirmed_at: '2026-10-12T00:00:00Z', can_edit: false, confirmed_requests: ['original-save'] }
const data = { stage: 'ecr', actor_id: 2, change: null, change_id: 10, updated_at: '2026-10-12T00:00:00Z', status: 'returned', current_round: 1, actions: [], tasks: [task], unanswered: [], issue_blockers: [], submission_request_id: null, submission_requests: [] }

test('revision participants receive read-only task history without the private revision body', () => {
  assert.equal(checkedStage(data, 10, 2), data)
  assert.throws(() => checkedStage({ ...data, actor_id: 3 }, 10, 2))
  assert.throws(() => checkedStage({ ...data, actions: [{}] }, 10, 2))
  assert.throws(() => checkedStage({ ...data, tasks: [{ ...task, can_edit: true }] }, 10, 2))
})

test('incomplete task or receipt responses are rejected before they can clear input or release an unknown operation', () => {
  for (const key of ['version', 'owner_id', 'date', 'confirmed_requests']) {
    const broken = { ...task }; delete broken[key]
    assert.throws(() => checkedStage({ ...data, tasks: [broken] }, 10, 2))
  }
  assert.throws(() => checkedStage({ ...data, tasks: [task, task] }, 10, 2))
  assert.throws(() => checkedStage({ ...data, tasks: [{ ...task, action_key: 'ecr_999' }] }, 10, 2))
  const broken = { ...data }; delete broken.submission_requests
  assert.throws(() => checkedStage(broken, 10, 2))
})
