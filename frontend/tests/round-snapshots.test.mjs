import assert from 'node:assert/strict'
import { test } from 'node:test'
import { QueryObserver } from '@tanstack/react-query'
import { adjacentSnapshotTab, checkedSnapshot, snapshotClient, snapshotPath } from '../src/roundSnapshots.ts'
import { canEdit } from '../src/workflow.ts'

const user = { id: 2, username: 'reviewer', display_name: 'Reviewer' }
test('historical navigation follows all eight sheets and returns to overview after the final sheet', () => {
  const sheets = ['overview', 'materials', 'questions', 'ecr', 'eco', 'emc', 'execution-plan', 'significant-change']
  for (let i = 0; i < sheets.length; i++) {
    assert.equal(adjacentSnapshotTab(sheets[i], 1), sheets[(i + 1) % sheets.length])
    assert.equal(adjacentSnapshotTab(sheets[i], -1), sheets[(i + sheets.length - 1) % sheets.length])
  }
  assert.equal(adjacentSnapshotTab('unknown', 1), 'overview')
})
const overview = { id: 5, applicant: 1, publisher_id: null, stage: 'ecr', status: 'pending', current_review_round: 1, review_mode: 'designated', submitted_at: '2026-10-14T00:00:00Z', created_at: '2026-10-14T00:00:00Z', updated_at: '2026-10-14T00:00:00Z', planned_eco_date: null, title: 'Original', ecr_no: 'ECR-5', eco_no: '', affected_products: '', affected_region: '', initiating_factory: '', affected_factories: '', ccb_owner: '', change_owner: '', change_reason: '' }
const actions = Array.from({ length: 61 }, (_, i) => ({ id: `ecr_${String(i + 1).padStart(3, '0')}`, number: 1, text: 'Action', function: 'Function', question_answer: 'N', required: false, extra_required: false, owner_user_id: null, owner_name: '', owner_active: false }))
const data = { actor_id: 2, change_id: 5, number: 1, tasks: [], snapshot: { version: 1, change_id: 5, number: 1, captured_at: overview.submitted_at, overview, actions, source_overview: null, sheets: { materials: [], questions: { questions: [] }, ecr: {}, eco: {}, emc: {}, execution_plan: {}, significant_change: {} } } }

test('snapshot responses bind identity, change, round, supported version and read-only tasks', () => {
  assert.equal(checkedSnapshot(data, 2, 5, 1).snapshot.overview.title, 'Original')
  assert.equal(snapshotPath(5, 1), '/api/changes/5/review-rounds/1/form-snapshot/')
  for (const invalid of [ { ...data, actor_id: 3 }, { ...data, number: 2 }, { ...data, snapshot: { ...data.snapshot, version: 2 } }, { ...data, tasks: [{ can_edit: true }] }, { ...data, snapshot: { ...data.snapshot, sheets: {} } } ]) {
    assert.throws(() => checkedSnapshot(invalid, 2, 5, 1))
  }
  assert.equal(checkedSnapshot({ ...data, snapshot: null }, 2, 5, 1).snapshot, null)
})

test('each historical round has isolated seeded caches and never automatically fetches live form data', async () => {
  const first = snapshotClient(checkedSnapshot(data, 2, 5, 1), user)
  const next = structuredClone(data); next.number = next.snapshot.number = next.snapshot.overview.current_review_round = 2; next.snapshot.overview.title = 'Revision'
  const second = snapshotClient(checkedSnapshot(next, 2, 5, 2), user)
  let fetched = 0
  const observer = new QueryObserver(first, { queryKey: ['materials', 2, 5], queryFn: () => { fetched++; return ['live body'] } })
  const unsubscribe = observer.subscribe(() => {})
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(fetched, 0)
  assert.deepEqual(observer.getCurrentResult().data, [])
  assert.equal(first.getQueryData(['stage-workflow', 2, 5]).change.title, 'Original')
  assert.equal(second.getQueryData(['stage-workflow', 2, 5]).change.title, 'Revision')
  assert.equal(canEdit(data.snapshot.overview, { ...user, id: 1 }), false)
  unsubscribe(); first.clear(); second.clear()
})
