import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkedPublishedResults } from '../src/actionOwners.ts'

const result = id => ({id, round: 1, owner: {id, username: 'owner' + id, display_name: 'Owner' + id, is_active: true}, result: 'Confirmation ' + id, status: 'completed', date: '2026-10-13', confirmed_at: '2026-10-13T00:00:00Z'})
test('published results retain both owners and their independent evidence', () => {
  const rows = [result(1), result(2)]
  assert.equal(checkedPublishedResults(rows), rows)
  assert.deepEqual(rows.map(row => row.result), ['Confirmation 1', 'Confirmation 2'])
  assert.deepEqual(checkedPublishedResults([]), [])
})
test('incomplete or duplicated source evidence cannot replace the confirmed snapshot', () => {
  for (const rows of [undefined, [result(1), result(1)], [{...result(1), confirmed_at: null}], [{...result(1), date: null}], [{...result(1), status: ''}], [{...result(1), result: ''}], [{...result(1), owner: null}]]) assert.throws(() => checkedPublishedResults(rows))
})
