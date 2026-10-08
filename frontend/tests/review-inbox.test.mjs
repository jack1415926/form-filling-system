import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkedInbox } from '../src/reviewInboxData.ts'

test('global inbox binds account and role and validates independent task counts and navigation targets', () => {
  const user = { id: 3, role: 'reviewer' }
  const item = { change_id: 1, round: 2, title: 'Review', ecr_no: 'ECR', status: 'pending', count: 3, summary: 'Task and two replies', open_issues: true, message_key: 'a'.repeat(64), is_read: false }
  const value = { actor_id: 3, role: 'reviewer', count: 3, unread_count: 3, items: [item] }
  assert.equal(checkedInbox(value, user), value)
  assert.equal(checkedInbox({ ...value, count: 0, unread_count: 0, items: [] }, user).count, 0)
  assert.equal(checkedInbox({ ...value, unread_count: 0, items: [{ ...item, is_read: true }] }, user).count, 3)
  for (const invalid of [null, {}, { ...value, actor_id: 4 }, { ...value, role: 'filler' }, { ...value, count: 1 },
    { ...value, items: [{ ...item, round: 0 }] }, { ...value, items: [{ ...item, open_issues: undefined }] },
    { ...value, count: 6, items: [item, item] }, { ...value, unread_count: 0 },
    { ...value, items: [{ ...item, message_key: 'old' }] }, { ...value, items: [{ ...item, is_read: undefined }] }]) assert.throws(() => checkedInbox(invalid, user))
})
