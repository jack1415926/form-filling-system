import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkedPublication, checkedCreatedEco, publicationSettled, newestPublication } from '../src/publication.ts'
import { checkedStage } from '../src/ecrStage.ts'
import { newestResponse } from '../src/latestResponse.ts'

const stamp = '2026-10-13T00:00:00Z'
const request = '11111111-1111-4111-8111-111111111111'
const change = { id: 10, applicant: 1, stage: 'ecr', publisher_id: 2, status: 'approved', current_review_round: 1, review_mode: 'designated', submitted_at: stamp,
  created_at: stamp, updated_at: stamp, source_ecr_id: null, source_ecr_no: null, eco_creation_request_id: null, published_by_id: null, published_at: null, publication_request_id: null,
  title: 'ECR', ecr_no: 'ECR-1', eco_no: '', affected_products: '', affected_region: '', initiating_factory: '', affected_factories: '', ccb_owner: '', change_owner: '', planned_eco_date: null, change_reason: '' }
const data = { actor_id: 2, change, publisher_name: 'Publisher', publisher_active: true, can_publish: true, can_create_eco: false, eco_id: null }
const published = { ...data, can_publish: false, change: { ...change, status: 'published', published_at: stamp, published_by_id: 2, publication_request_id: request } }

test('publication checks actor, capability, evidence and read-only source', () => {
  assert.equal(checkedPublication(data, 10, 2), data)
  assert.equal(checkedPublication(published, 10, 2), published)
  for (const broken of [{ ...data, actor_id: 1 }, { ...data, can_create_eco: true }, { ...data, eco_id: 50 }, { ...published, can_publish: true },
    { ...published, change: { ...published.change, published_at: null } }, { ...published, change: { ...published.change, publication_request_id: null } }]) {
    assert.throws(() => checkedPublication(broken, 10, 2))
  }
})

test('creation response identifies an independent ECO and cannot confirm a different source', () => {
  const eco = { ...change, id: 20, stage: 'eco', status: 'draft', ecr_no: '', source_ecr_id: 10, source_ecr_no: 'ECR-1', eco_creation_request_id: request }
  assert.equal(checkedCreatedEco({ created: true, change: eco }, 10, 1), eco)
  assert.equal(checkedCreatedEco({ created: false, change: { ...eco, title: 'already edited' } }, 10, 1).title, 'already edited')
  for (const patch of [{ source_ecr_id: 11 }, { applicant: 2 }, { stage: 'ecr' }, { ecr_no: 'ECR-1' }, { eco_creation_request_id: null }]) {
    assert.throws(() => checkedCreatedEco({ created: true, change: { ...eco, ...patch } }, 10, 1))
  }
})

test('unknown publish or creation is released only by a verified terminal result; late reads retain newer state', () => {
  assert.equal(publicationSettled(data, { kind: 'publish', request_id: request, expected_round: 1 }), false)
  assert.equal(publicationSettled(published, { kind: 'publish', request_id: request, expected_round: 1 }), true)
  assert.equal(publicationSettled(published, { kind: 'create', request_id: request }), false)
  assert.equal(publicationSettled({ ...published, eco_id: 20 }, { kind: 'create', request_id: request }), true)
  const newer = { ...published.change, updated_at: '2026-10-13T00:01:00Z' }
  assert.equal(newestResponse(newer, change), newer)
})

test('published ECR preserves stage response and rejects editable terminal tasks', () => {
  const stage = { stage: 'ecr', actor_id: 2, change: null, change_id: 10, updated_at: stamp, status: 'published', current_round: 1, tasks: [], actions: [], unanswered: [], issue_blockers: [], submission_requests: [], submission_request_id: null }
  assert.equal(checkedStage(stage, 10, 2), stage)
})

test('ECO recovery observes a new link at the unchanged source timestamp and late reads cannot erase it', () => {
  const noEco = { ...published, actor_id: 1, can_create_eco: true }
  const withEco = { ...noEco, eco_id: 20, can_create_eco: false }
  assert.equal(newestPublication(noEco, withEco).eco_id, 20)
  assert.equal(newestPublication(withEco, noEco).eco_id, 20)
  assert.equal(newestPublication(withEco, noEco).can_create_eco, false)
})
