import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Autosave } from '../src/autosave.ts'
import { ApiError } from '../src/api.ts'
import { emcFields, emcPayload, materialFields, materialPayload, questionFields, questionPayload } from '../src/autosaveFields.ts'

const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
function setup(send, initial = { title: 'original', region: 'old' }) {
  let now = 0, id = 0
  const timers = new Map()
  const clock = { now: () => now, set: (fn, ms) => { timers.set(++id, { at: now + ms, fn }); return id }, clear: (key) => timers.delete(key) }
  const queue = new Autosave(initial, send, () => {}, clock)
  const tick = async (ms) => {
    const end = now + ms
    while (true) {
      const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0]
      if (!next || next[1].at > end) break
      now = next[1].at; timers.delete(next[0]); next[1].fn(); await settle()
    }
    now = end; await settle()
  }
  return { queue, tick, timers }
}

test('typing debounces for two seconds and reverting before dispatch sends nothing', async () => {
  const calls = [], server = { title: 'original', region: 'old' }
  const { queue, tick } = setup(async (patch) => { calls.push(patch); return Object.assign(server, patch) })
  queue.update({ title: 'one' }); await tick(1500); queue.update({ title: 'two' })
  await tick(1999); assert.equal(calls.length, 0)
  await tick(1); assert.deepEqual(calls, [{ title: 'two' }]); assert.equal(queue.dirty, false)
  queue.update({ title: 'temporary' }); queue.update({ title: 'two' }); await tick(3000)
  assert.equal(calls.length, 1)
})

test('one in-flight request preserves later edits, including changes then reverts and null clears', async () => {
  let resolve
  const calls = []
  const { queue, tick } = setup((patch) => { calls.push(patch); return new Promise((done) => { resolve = done }) }, { title: 'old', date: '2026-10-03', region: 'old' })
  queue.update({ title: 'submitted' }); await tick(2000)
  queue.update({ title: 'temporary', region: 'new', date: null }); queue.update({ title: 'old' })
  await tick(3000); assert.equal(calls.length, 1)
  resolve({ title: 'submitted', date: '2026-10-03', region: 'external' }); await settle()
  assert.equal(queue.values.title, 'old'); assert.equal(queue.values.region, 'new'); assert.equal(queue.values.date, null)
  await tick(0)
  assert.deepEqual(calls[1], { title: 'old', date: null, region: 'new' })
  resolve({ title: 'old', date: null, region: 'new' }); await settle(); assert.equal(queue.dirty, false)
})

test('ambiguous failures retry latest input at 5 and 15 seconds, then stop even after editing', async () => {
  const calls = []
  const { queue, tick, timers } = setup(async (patch) => { calls.push(patch); throw new ApiError(503, 'offline') })
  queue.update({ title: 'one' }); await tick(2000)
  queue.update({ title: 'original' }); await tick(4999); assert.equal(calls.length, 1)
  await tick(1); assert.deepEqual(calls[1], { title: 'original' })
  queue.update({ title: 'new' }); await tick(14999); assert.equal(calls.length, 2)
  await tick(1); assert.deepEqual(calls[2], { title: 'new' })
  queue.update({ title: 'last' }); await tick(60000); assert.equal(calls.length, 3); assert.equal(timers.size, 0)
  await assert.rejects(queue.flush()); assert.equal(calls.length, 4)
})

test('400 resumes only after correction; auth, CSRF, 404 and 409 pause and preserve dirty input', async () => {
  for (const status of [400, 401, 403, 404, 409]) {
    let count = 0
    const { queue, tick } = setup(async () => { count++; throw new ApiError(status, 'rejected') })
    queue.update({ title: 'one' }); await tick(2000); await tick(60000); assert.equal(count, 1)
    queue.update({ title: 'two' }); await tick(2000); assert.equal(count, status === 400 ? 2 : 1)
    assert.equal(queue.dirty, true); assert.equal(queue.unconfirmed.size, 0)
    if ([401, 403].includes(status)) { queue.resume(); await tick(2000); assert.equal(count, 2) }
  }
})

test('manual save waits for in-flight autosave and drains new changes before resolving', async () => {
  let resolve
  const calls = []
  const { queue, tick } = setup((patch) => { calls.push(patch); return new Promise((done) => { resolve = done }) })
  queue.update({ title: 'one' }); await tick(2000); queue.update({ title: 'two' })
  const manual = queue.flush(); assert.equal(queue.manual, true); assert.equal(calls.length, 1)
  resolve({ title: 'one', region: 'old' }); await settle(); assert.deepEqual(calls[1], { title: 'two' })
  resolve({ title: 'two', region: 'old' }); await manual
  assert.equal(queue.manual, false); assert.equal(queue.dirty, false)
})

test('composition, incomplete dates and confirmations pause timers; explicit save works in a confirmation', async () => {
  let count = 0
  const { queue, tick } = setup(async (patch) => { count++; return { ...queue.baseline, ...patch } })
  queue.update({ title: 'new' }); queue.configure(true, false, false); await tick(3000); assert.equal(count, 0)
  await assert.rejects(queue.flush()); queue.configure(true, true, true); await tick(3000); assert.equal(count, 0)
  await queue.flush(); assert.equal(count, 1)
  queue.configure(true, true, false); queue.update({ title: 'later' }); queue.dispose(); await tick(3000); assert.equal(count, 1)
})

test('late responses after disposal do not change the draft or schedule another save', async () => {
  let resolve
  const { queue, tick, timers } = setup(() => new Promise((done) => { resolve = done }))
  queue.update({ title: 'new' }); await tick(2000); queue.dispose()
  resolve({ title: 'new', region: 'server' }); await settle()
  assert.equal(queue.baseline.title, 'original'); assert.equal(timers.size, 0)
})

test('closing a manually saved drawer releases its parent navigation lock', async () => {
  const { queue } = setup(async (patch) => ({ ...queue.baseline, ...patch }))
  let parentBusy = true
  queue.setOnDispose(() => { parentBusy = false })
  queue.update({ title: 'saved' }); await queue.flush(); queue.dispose()
  assert.equal(parentBusy, false)
})

test('new material requires manual creation, including blank fields, and unknown results keep the creation protected', async () => {
  let calls = 0
  const { queue, tick } = setup(async () => { calls++; throw new ApiError(0, 'lost') }, { material_no: '', description: '' })
  queue.configure(false, true, false); queue.update({ description: 'draft' }); await tick(3000); assert.equal(calls, 0)
  queue.update({ description: '' }); await assert.rejects(queue.flush(true))
  assert.equal(calls, 1); assert.equal(queue.dirty, true); await tick(30000); assert.equal(calls, 1)
})

test('stable nested keys preserve local PATCH shapes, omitted fields, and explicit clears', () => {
  assert.deepEqual(questionPayload({ '13.answer': 'N', '5.remark': '' }), { responses: { '13': { answer: 'N' }, '5': { remark: '' } } })
  assert.deepEqual(questionFields({ questions: [{ number: 13, answer: '', remark: '' }] }), { '13.answer': '', '13.remark': '' })
  assert.deepEqual(materialPayload({ description: 'new', 'company_finished.remark': '' }), { description: 'new', dispositions: { company_finished: { remark: '' } } })
  assert.deepEqual(materialFields({ description: 'old', dispositions: { company_finished: { disposition: 'NA' } } }, ['description']), { description: 'old', 'company_finished.disposition': 'NA', 'company_finished.remark': '' })
  assert.deepEqual(emcPayload({ 'row/test.mark': '', 'row/test.remark': '' }), { cells: { 'row/test': { mark: '', remark: '' } } })
  assert.deepEqual(emcFields({ cells: { 'row/test': { mark: '(X)', remark: 'note' } } }), { 'row/test.mark': '(X)', 'row/test.remark': 'note' })
})

test('successful deletion of optional nested fields does not create an endless blank PATCH', async () => {
  const { queue } = setup(async () => ({}), { 'row/test.mark': 'X', 'row/test.remark': 'note' })
  queue.update({ 'row/test.mark': '', 'row/test.remark': '' }); await queue.flush()
  assert.deepEqual(queue.patch, {}); assert.equal(queue.dirty, false)
})
