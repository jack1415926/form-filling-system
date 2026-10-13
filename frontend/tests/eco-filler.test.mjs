import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkedFillerData, checkedFillerReceipt } from '../src/ecoFiller.ts'
import { checkedCreatedEco, checkedPublication, publicationSettled } from '../src/publication.ts'

const stamp = '2026-10-13T00:00:00Z', request = '11111111-1111-4111-8111-111111111111'
const person = id => ({id, display_name: 'User' + id, username: 'user' + id, is_active: true})
const change = {id: 10, applicant: 2, stage: 'eco', status: 'draft', current_review_round: 0, review_mode: '', submitted_at: null, created_at: stamp, updated_at: stamp, source_ecr_id: 5, source_ecr_no: 'SOURCE', eco_creation_request_id: request, title: 'ECO', ecr_no: '', eco_no: '', affected_products: '', affected_region: '', initiating_factory: '', affected_factories: '', ccb_owner: '', change_owner: '', planned_eco_date: null, change_reason: ''}
const receipt = {actor_id: 1, change_id: 10, kind: 'transfer', request_id: request, filler_id: 2, previous_filler_id: 1, created_at: stamp}
const assignment = {actor_id: 1, change_id: 10, change, filler: person(2), can_transfer: true, history: [{...receipt, actor: person(1), previous_filler: person(1), filler: person(2)}]}

test('assignment responses separate the viewer from the designated filler', () => {
  assert.equal(checkedFillerData(assignment, 10, 1), assignment)
  for (const patch of [{actor_id: 3}, {filler: person(3)}, {change: {...change, status: 'published'}}, {history: [{...assignment.history[0], filler: person(4)}]}]) assert.throws(() => checkedFillerData({...assignment, ...patch}, 10, 1))
})
test('only the original request and target confirm a handoff, including after loss of body access', () => {
  assert.equal(checkedFillerReceipt(receipt, 10, 1, {request_id: request, filler_id: 2}), receipt)
  for (const patch of [{actor_id: 2}, {change_id: 20}, {filler_id: 3}, {previous_filler_id: null}, {request_id: '22222222-2222-4222-8222-222222222222'}]) assert.throws(() => checkedFillerReceipt({...receipt, ...patch}, 10, 1, {request_id: request, filler_id: 2}))
})
test('creation confirms the chosen filler and original receipt even after a later transfer', () => {
  const creation = {...receipt, kind: 'create', previous_filler_id: null}
  assert.equal(checkedCreatedEco({created: true, change, receipt: creation}, 5, 1, 2, request), change)
  assert.equal(checkedCreatedEco({created: false, change: {...change, applicant: 3}, receipt: creation}, 5, 1, 2, request).applicant, 3)
  assert.throws(() => checkedCreatedEco({created: true, change}, 5, 1, 2, request))
  assert.throws(() => checkedCreatedEco({created: true, change, receipt: creation}, 5, 1, 3, request))
})
test('the actual ECR publisher can create and inspect ECO; an unrelated link is not a request receipt', () => {
  const source = {...change, id: 5, applicant: 3, stage: 'ecr', status: 'published', source_ecr_id: null, ecr_no: 'SOURCE', published_by_id: 1, published_at: stamp, publication_request_id: request}
  const data = {actor_id: 1, change: source, publisher_name: 'User1', publisher_active: true, can_publish: false, can_create_eco: true, eco_id: null}
  assert.equal(checkedPublication(data, 5, 1), data)
  const operation = {kind: 'create', request_id: request, filler_id: 2}
  assert.equal(publicationSettled({...data, eco_id: 10, eco_filler_id: 2}, operation), false)
  assert.equal(publicationSettled({...data, eco_id: 10, eco_creation_receipt: {...receipt, kind: 'create', previous_filler_id: null}}, operation), true)
})
