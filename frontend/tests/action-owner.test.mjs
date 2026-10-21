import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkedActionData } from '../src/actionOwners.ts'

test('both action responses require consistent multi-owner metadata and retain inactive linked users', () => {
  for (const prefix of ['ecr', 'eco']) {
    const data = { updated_at: '2026-10-12T00:00:00Z', actions: Array.from({ length: 61 }, (_, i) => ({ id: `${prefix}_${String(i + 1).padStart(3, '0')}`, number: 1, function: 'Test', text: 'Action', question_answer: '', owner_user_ids: [], owner_users: [], result: '', status: '', date: null })) }
    assert.equal(checkedActionData(data, prefix), data)
    for (const mutate of [row => delete row.owner_user_ids, row => delete row.owner_users,
      row => { row.owner_user_ids = [3]; row.owner_users = [{ id: 4, username: 'wrong', display_name: 'Wrong', is_active: true }] },
      row => { row.owner_user_ids = [3, 3]; row.owner_users = [] }]) {
      const invalid = structuredClone(data); mutate(invalid.actions[0]); assert.throws(() => checkedActionData(invalid, prefix), /响应不完整/)
    }
    assert.throws(() => checkedActionData({ ...data, actions: [] }, prefix), /响应不完整/)
    const linked = structuredClone(data)
    linked.actions[0].owner_user_ids = [3, 4]
    linked.actions[0].owner_users = [{ id: 3, username: 'first', display_name: 'First', is_active: true }, { id: 4, username: 'disabled', display_name: 'Disabled', is_active: false }]
    assert.equal(checkedActionData(linked, prefix), linked)
  }
})