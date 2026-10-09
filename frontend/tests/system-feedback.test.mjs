import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkedFeedback, checkedFeedbackPage, feedbackConfirmed, newerFeedback, checkedFeedbackInbox, feedbackMessageVersion, unreadFeedbackEvent } from '../src/systemFeedback.ts'
const request = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const actionRequest = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'
const initial = { id: 4, submitter: { id: 2, display_name: '用户' }, category: 'problem', content: '问题', status: 'pending', request_id: request, version: 0, created_at: '2026-10-08T01:00:00Z', updated_at: '2026-10-08T01:00:00Z', events: [] }
const handled = { ...initial, version: 1, status: 'processing', events: [{ id: 8, actor: { id: 3, display_name: '管理员' }, text: '', from_status: 'pending', to_status: 'processing', request_id: actionRequest, base_version: 0, created_at: '2026-10-08T01:01:00Z' }] }

test('feedback response protects ownership, completeness, status history and identity', () => {
  assert.equal(checkedFeedback(initial, { owner: 2, id: 4 }), initial)
  assert.equal(checkedFeedback(handled), handled)
  assert.throws(() => checkedFeedback(initial, { owner: 3 }))
  assert.throws(() => checkedFeedback(initial, { id: 5 }))
  for (const change of [{ events: undefined }, { version: 1 }, { status: 'closed' }, { category: 'constructor' }, { request_id: '' }, { submitter: { id: 0, display_name: 'x' } }]) assert.throws(() => checkedFeedback({ ...initial, ...change }))
  assert.throws(() => checkedFeedback({ ...handled, events: [{ ...handled.events[0], base_version: 2 }] }))
})
test('confirm original UUID and payload after a later administrator update', () => {
  const create = { kind: 'create', category: 'problem', content: '问题', request_id: request }
  assert.equal(feedbackConfirmed(create, handled, 2), true)
  assert.equal(feedbackConfirmed({ ...create, content: '其他' }, handled, 2), false)
  assert.equal(feedbackConfirmed(create, handled, 3), false)
  const action = { kind: 'action', id: 4, status: 'processing', text: '', expected_version: 0, request_id: actionRequest }
  assert.equal(feedbackConfirmed(action, handled, 3), true)
  for (const change of [{ id: 5 }, { text: '其他' }, { status: 'closed' }, { expected_version: 1 }, { request_id: request }]) assert.equal(feedbackConfirmed({ ...action, ...change }, handled, 3), false)
  assert.equal(feedbackConfirmed(action, handled, 2), false)
  assert.equal(newerFeedback(handled, initial), handled)
})
test('feedback lists reject cross-account rows and malformed pagination', () => {
  const page = { count: 1, results: [initial], next: null, previous: null }
  assert.equal(checkedFeedbackPage(page, 2), page)
  assert.throws(() => checkedFeedbackPage(page, 3))
  assert.throws(() => checkedFeedbackPage({ ...page, count: -1 }))
  assert.throws(() => checkedFeedbackPage({ ...page, next: 5 }))
})

test('followup confirms original event after a later state update without confusing manager replies', () => {
  const event = { ...handled.events[0], kind: 'followup', actor: initial.submitter, text: '追问', to_status: 'pending' }
  const result = { ...initial, version: 1, events: [event] }
  const operation = { kind: 'followup', id: 4, text: '追问', status: 'closed', expected_version: 0, request_id: actionRequest }
  assert.equal(checkedFeedback(result), result)
  assert.equal(feedbackConfirmed(operation, result, 2), true)
  assert.equal(feedbackConfirmed(operation, { ...result, events: [{ ...event, kind: 'manager' }] }, 2), false)
  assert.equal(feedbackMessageVersion(result, 2), null)
  assert.equal(feedbackMessageVersion(result, 3), 1)
  assert.equal(feedbackMessageVersion(handled, 2), 1)
  assert.equal(feedbackMessageVersion(initial, 3), 0)
  assert.equal(feedbackMessageVersion(handled, 3), 0)
})

test('feedback unread snapshots reject invalid versions, duplicate items and malformed counts', () => {
  const item = { id: 4, message_version: 0, read_version: null, content: '反馈', status: 'pending', managed: true }
  const inbox = { unread_count: 1, items: [item] }
  assert.equal(checkedFeedbackInbox(inbox), inbox)
  for (const change of [{ unread_count: 0 }, { items: [{ ...item, message_version: -1 }] }, { items: [{ ...item, managed: 'yes' }] }, { items: [{ ...item, read_version: undefined }] }, { items: [{ ...item, read_version: 0 }] }, { unread_count: 2, items: [item, item] }]) {
    assert.throws(() => checkedFeedbackInbox({ ...inbox, ...change }))
  }
})

test('individual unread markers distinguish received events from old reads and own messages', () => {
  const reply = { ...handled.events[0], kind: 'manager' }
  const followup = { ...reply, kind: 'followup', actor: initial.submitter, text: '追加', base_version: 1 }
  const nextReply = { ...reply, id: 10, base_version: 2 }
  const ownerItem = { id: 4, message_version: 3, read_version: 1, managed: false }
  assert.equal(unreadFeedbackEvent(reply, handled, ownerItem, 2), false)
  assert.equal(unreadFeedbackEvent(nextReply, handled, ownerItem, 2), true)
  assert.equal(unreadFeedbackEvent(followup, handled, ownerItem, 2), false)
  assert.equal(unreadFeedbackEvent(nextReply, handled, undefined, 2), false)
  assert.equal(unreadFeedbackEvent(nextReply, handled, { ...ownerItem, id: 5 }, 2), false)
  const managerItem = { ...ownerItem, managed: true, message_version: 2, read_version: 0 }
  assert.equal(unreadFeedbackEvent(followup, handled, managerItem, 3), true)
  assert.equal(unreadFeedbackEvent(reply, handled, managerItem, 3), false)
  assert.equal(unreadFeedbackEvent(reply, handled, { ...ownerItem, read_version: null }, 2), true)
})
