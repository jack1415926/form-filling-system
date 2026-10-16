import test from 'node:test'
import assert from 'node:assert/strict'
import { checkedEngineering, processMenu } from '../src/engineeringChangeData.ts'
import { currentProcessIndex } from '../src/stageNavigationData.ts'

const summary = (stage, id, status, can_open = true) => ({ stage, id, status, number: stage.toUpperCase(), current_round: 1, confirmed: 0, total: 1, approved_at: null, published_at: null, updated_at: '2026-10-13T01:00:00Z', can_open })
const row = () => ({ id: 1, title: 'Change', ecr: summary('ecr', 1, 'published', false), eco: summary('eco', 2, 'draft'), can_create_eco: false, can_delete_ecr: false })

test('关联列表允许来源摘要但拒绝错账号、重复记录、隐藏数据泄漏和非法能力', () => {
  const valid = { actor_id: 9, items: [row()] }
  assert.equal(checkedEngineering(valid, 9).items[0].eco.id, 2)
  assert.throws(() => checkedEngineering(valid, 10))
  assert.throws(() => checkedEngineering({ actor_id: 9, items: [row(), row()] }, 9))
  const hidden = row(); hidden.eco.status = 'unavailable'; hidden.eco.can_open = false
  assert.throws(() => checkedEngineering({ actor_id: 9, items: [hidden] }, 9))
  const malformed = row(); malformed.can_create_eco = true
  assert.throws(() => checkedEngineering({ actor_id: 9, items: [malformed] }, 9))
  malformed.can_create_eco = false; malformed.can_delete_ecr = true
  assert.throws(() => checkedEngineering({ actor_id: 9, items: [malformed] }, 9))
})

test('发起人的删除能力可用于所有流程状态，但不可用于无来源正文权限的记录', () => {
  for (const status of ['draft', 'pending', 'returned', 'approved', 'published']) {
    const item = row(); item.ecr = summary('ecr', 1, status); item.can_delete_ecr = true
    assert.equal(checkedEngineering({ actor_id: 9, items: [item] }, 9).items[0].can_delete_ecr, true)
  }
})

test('两份流程均保留八表导航且自己的进度不受另一流程影响', () => {
  for (const stage of ['ecr', 'eco']) {
    const flat = processMenu(stage).flatMap(item => item.children ?? [item])
    for (const key of ['overview', 'materials', 'questions', 'ecr', 'eco', 'emc', 'execution-plan', 'significant-change', 'summary', 'history', 'submission']) assert.ok(flat.some(item => item.key === key))
    assert.ok(processMenu(stage).every(item => !('children' in item)))
    assert.equal(flat.find(item => item.key === 'questions').label, '问题评估')
    assert.equal(flat.at(-1).key, 'history')
    assert.equal(processMenu(stage, true).at(-1).key, 'history')
    assert.ok(!processMenu(stage, true).some(item => item.key === 'submission'))
    for (const [status, index] of [['draft', 0], ['returned', 0], ['pending', 1], ['approved', 2], ['published', 3]]) assert.equal(currentProcessIndex({ stage, status }), index)
  }
})
