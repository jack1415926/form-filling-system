import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkedStage, saveTaskPatch, taskConfirmationState, stageSubmissionState } from '../src/ecrStage.ts'
import { checkedNavigation, newestNavigation, stageSteps } from '../src/stageNavigationData.ts'
import { checkedPublication } from '../src/publication.ts'
import { checkedInbox } from '../src/reviewInboxData.ts'

const stamp = '2026-10-13T00:00:00Z'
const task = { id: 1, round: 1, action_key: 'eco_001', owner_id: 2, owner_name: 'Owner', result: 'scheduled work', status: 'implementation_stage', date: '2026-10-13', version: 2, confirmed_at: null, can_edit: false, confirmed_requests: [] }
const data = { stage: 'eco', actor_id: 2, change: null, change_id: 10, updated_at: stamp, status: 'returned', current_round: 1, actions: [], tasks: [task], unanswered: [], issue_blockers: [], submission_request_id: null, submission_requests: [] }
const hidden = stage => ({ stage, id: null, status: 'unavailable', number: null, current_round: null, confirmed: null, total: null, approved_at: null, published_at: null, updated_at: null, can_open: false })
const visible = { ...hidden('eco'), id: 10, status: 'pending', number: 'ECO-10', current_round: 1, confirmed: 1, total: 2, updated_at: stamp, can_open: true }

test('ECO stage responses distinguish their action namespace and business status from ECR', () => {
  assert.equal(checkedStage(data, 10, 2), data)
  assert.throws(() => checkedStage({ ...data, stage: 'ecr' }, 10, 2))
  assert.throws(() => checkedStage({ ...data, tasks: [{ ...task, action_key: 'ecr_001' }] }, 10, 2))
  assert.throws(() => checkedStage({ ...data, stage: undefined }, 10, 2))
})

test('ECO save recovery keeps original UUID, newer input and old-round confirmation protection', async () => {
  const state = { task: { ...task, status: '', can_edit: true }, pending: null }, calls = []
  let server = { ...state.task }, lost = true
  const send = async payload => {
    calls.push(payload)
    if (!server.confirmed_requests.includes(payload.request_id)) server = { ...server, result: payload.result, version: server.version + 1, confirmed_requests: [...server.confirmed_requests, payload.request_id] }
    if (lost) { lost = false; throw new Error('lost ECO save response') }
    return server
  }
  await assert.rejects(saveTaskPatch(state, { result: 'first' }, send))
  assert.equal((await saveTaskPatch(state, { result: 'later' }, send)).result, 'later')
  assert.equal(calls[0].request_id, calls[1].request_id)
  assert.notEqual(calls[1].request_id, calls[2].request_id)
  assert.equal(taskConfirmationState({ ...server, can_edit: false }, { request_id: 'old', version: 1 }), 'ended')
})

test('six stage nodes show terminal completion, return to revision and zero-task approval awaiting release', () => {
  assert.deepEqual(stageSteps({ ...visible, stage: 'ecr', status: 'published' }).map(step => step.status), ['finish', 'finish', 'finish'])
  assert.deepEqual(stageSteps({ ...visible, status: 'approved', confirmed: 0, total: 0 }).map(step => step.status), ['finish', 'finish', 'process'])
  const returned = stageSteps({ ...visible, status: 'returned', confirmed: 0, total: 0 })
  assert.deepEqual(returned.map(step => step.status), ['process', 'wait', 'wait'])
  assert.match(returned[0].description, /待修订/)
})

test('navigation rejects hidden metadata leaks and drops stale permissions while retaining newer task progress', () => {
  const current = { actor_id: 2, current_change_id: 10, stages: [hidden('ecr'), visible] }
  assert.equal(checkedNavigation(current, 10, 2), current)
  assert.throws(() => checkedNavigation({ ...current, stages: [{ ...hidden('ecr'), number: 'private' }, visible] }, 10, 2))
  const newer = { ...current, stages: [hidden('ecr'), { ...visible, updated_at: '2026-10-13T00:01:00Z', confirmed: 2 }] }
  assert.equal(newestNavigation(newer, current).stages[1].confirmed, 2)
  assert.equal(newestNavigation(newer, { ...current, stages: [hidden('ecr'), hidden('eco')] }).stages[1].status, 'unavailable')
})

test('ECO pending publication supports evidence but never exposes ECR-only creation', () => {
  const request = '11111111-1111-4111-8111-111111111111'
  const change = { id: 10, applicant: 1, stage: 'eco', publisher_id: 2, status: 'approved', current_review_round: 1, review_mode: 'designated', submitted_at: stamp,
    created_at: stamp, updated_at: stamp, source_ecr_id: 5, source_ecr_no: 'ECR-5', eco_creation_request_id: request, published_by_id: null, published_at: null, publication_request_id: null,
    title: 'ECO', ecr_no: '', eco_no: 'ECO-10', affected_products: '', affected_region: '', initiating_factory: '', affected_factories: '', ccb_owner: '', change_owner: '', planned_eco_date: null, change_reason: '' }
  const publication = { actor_id: 2, change, publisher_name: 'Publisher', publisher_active: true, can_publish: true, can_create_eco: false, eco_id: null }
  assert.equal(checkedPublication(publication, 10, 2), publication)
  assert.equal(checkedPublication({ ...publication, can_publish: false, change: { ...change, status: 'published', published_at: stamp, published_by_id: 2, publication_request_id: request } }, 10, 2).change.status, 'published')
  assert.throws(() => checkedPublication({ ...publication, can_create_eco: true }, 10, 2))
})

test('publication inbox accepts the ECO stage and approved state without duplicating the application', () => {
  const item = { context: 'reviewer', stage: 'eco', eco_no: 'ECO-10', change_id: 10, round: 1, title: 'ECO', ecr_no: 'ECR-5', status: 'approved', count: 1, summary: '待本人发布', open_issues: false, message_key: '1'.repeat(64), is_read: false }
  const inbox = { actor_id: 2, role: 'filler', count: 1, unread_count: 1, items: [item] }
  assert.equal(checkedInbox(inbox, { id: 2, role: 'filler' }), inbox)
  assert.throws(() => checkedInbox({ ...inbox, count: 2, unread_count: 2, items: [item, item] }, { id: 2, role: 'filler' }))
})

test('unknown stage submission releases protection after another request advances or returns the round', () => {
  const payload = { request_id: 'original', expected_round: 1, acknowledge_no_tasks: false }
  assert.equal(stageSubmissionState(data, payload), 'retryable')
  assert.equal(stageSubmissionState({ ...data, status: 'pending', current_round: 2, submission_requests: ['other'] }, payload), 'ended')
  assert.equal(stageSubmissionState({ ...data, status: 'returned', current_round: 2, submission_requests: ['other'] }, payload), 'ended')
  assert.equal(stageSubmissionState({ ...data, status: 'published', current_round: 2, submission_requests: ['original'] }, payload), 'confirmed')
})
