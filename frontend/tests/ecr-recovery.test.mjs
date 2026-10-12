import assert from 'node:assert/strict'
import { test } from 'node:test'
import { QueryClient } from '@tanstack/react-query'
import { Autosave } from '../src/autosave.ts'
import { ApiError } from '../src/api.ts'
import { checkedStage, saveTaskPatch, taskConfirmationState } from '../src/ecrStage.ts'

const task = { id: 1, round: 1, action_key: 'ecr_001', owner_id: 2, owner_name: 'Owner', result: 'baseline', status: '', date: null, version: 1, confirmed_at: null, can_edit: true, confirmed_requests: [] }
const clock = { now: () => 0, set: () => 0, clear: () => {} }

test('lost save replays its original UUID then persists the newer queue patch instead of erasing it', async () => {
  const state = { task: { ...task }, pending: null }, calls = []
  let server = { ...task }, lost = true
  const queue = new Autosave({ result: 'baseline', status: '', date: null }, patch => saveTaskPatch(state, patch, async payload => {
    calls.push({ ...payload })
    if (lost) {
      lost = false
      server = { ...server, result: payload.result, version: 2, confirmed_requests: [payload.request_id] }
      throw new ApiError(0, 'lost response')
    }
    if (!server.confirmed_requests.includes(payload.request_id)) {
      assert.equal(payload.version, server.version)
      server = { ...server, result: payload.result, version: server.version + 1, confirmed_requests: [...server.confirmed_requests, payload.request_id] }
    }
    return { ...server }
  }), () => {}, clock)
  queue.update({ result: 'first edit' }); await assert.rejects(queue.flush())
  queue.update({ result: 'latest edit' }); await queue.flush()
  assert.equal(calls.length, 3)
  assert.deepEqual(calls[1], calls[0])
  assert.notEqual(calls[2].request_id, calls[0].request_id)
  assert.equal(calls[2].version, 2)
  assert.equal(server.result, 'latest edit')
  assert.equal(queue.values.result, 'latest edit'); assert.equal(queue.dirty, false)
  queue.dispose()
})

test('a delayed stage read cannot replace the newer cache written by a save', async () => {
  const client = new QueryClient(), key = ['stage-workflow', 2, 10]
  const old = { actor_id: 2, change: null, change_id: 10, updated_at: '2026-10-12T00:00:01Z', status: 'returned', current_round: 1, actions: [], tasks: [{ ...task, can_edit: false }], unanswered: [], issue_blockers: [], submission_request_id: null, submission_requests: [] }
  const latest = { ...old, updated_at: '2026-10-12T00:00:02Z', tasks: [{ ...task, version: 2, result: 'newer', can_edit: false }] }
  let complete
  const flight = client.fetchQuery({ queryKey: key, queryFn: async () => checkedStage(await new Promise(resolve => { complete = resolve }), 10, 2, client.getQueryData(key)) })
  client.setQueryData(key, latest); complete(old); await flight
  assert.equal(client.getQueryData(key).tasks[0].version, 2)
  assert.equal(client.getQueryData(key).tasks[0].result, 'newer')
  client.clear()
})

test('confirmation recovery checks the original receipt before deciding whether retry is still allowed', () => {
  const payload = { request_id: 'original-confirm', version: 1 }
  assert.equal(taskConfirmationState(task, payload), 'retryable')
  for (const ended of [{ ...task, can_edit: false }, { ...task, version: 2 }, undefined]) assert.equal(taskConfirmationState(ended, payload), 'ended')
  assert.equal(taskConfirmationState({ ...task, can_edit: false, version: 3, confirmed_at: '2026-10-12T00:00:00Z', confirmed_requests: [payload.request_id] }, payload), 'confirmed')
})
