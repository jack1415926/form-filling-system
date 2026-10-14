import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ApiError } from '../src/api.ts'
import { saveResultUnconfirmed } from '../src/questionDraft.ts'
import { questionAnswerFields, questionFields, questionPayload } from '../src/autosaveFields.ts'

test('bulk question answers fill all 27 while preserving remarks and allowing individual corrections', () => {
  const data = { questions: Array.from({length: 27}, (_, i) => ({ number: i + 1, answer: i % 2 ? 'Y' : '', remark: `Remark ${i + 1}` })) }
  for (const answer of ['Y', 'N']) {
    const patch = questionAnswerFields(data, answer)
    assert.equal(Object.keys(patch).length, 27)
    assert.ok(Object.keys(patch).every(key => key.endsWith('.answer')))
    const values = { ...questionFields(data), ...patch }
    assert.ok(data.questions.every(row => values[`${row.number}.answer`] === answer && values[`${row.number}.remark`] === row.remark))
    assert.deepEqual(questionPayload(patch).responses['27'], {answer})
    values['1.answer'] = answer === 'Y' ? 'N' : 'Y'
    assert.notEqual(values['1.answer'], values['2.answer'])
  }
  assert.equal(data.questions[0].answer, '')
})

test('ECO keeps inherited ECR answers until explicitly changed and bulk updates do not modify source data', () => {
  const ecr = { questions: Array.from({length: 27}, (_, i) => ({ number: i + 1, answer: i === 0 ? 'Y' : 'N', remark: `Source remark ${i + 1}` })) }
  const eco = structuredClone(ecr)
  const inherited = questionFields(eco)
  assert.equal(inherited['1.answer'], 'Y')
  const changed = { ...inherited, ...questionAnswerFields(eco, 'N') }
  assert.equal(changed['1.answer'], 'N')
  assert.equal(changed['1.remark'], 'Source remark 1')
  assert.equal(ecr.questions[0].answer, 'Y')
  assert.equal(eco.questions[0].answer, 'Y')
})

test('only ambiguous failures require confirmation, including unreadable success responses', () => {
  for (const status of [0, 200, 502, 500]) assert.equal(saveResultUnconfirmed(new ApiError(status, '错误')), true)
  for (const status of [400, 401, 403, 404, 405, 409]) assert.equal(saveResultUnconfirmed(new ApiError(status, '拒绝')), false)
  assert.equal(saveResultUnconfirmed(new Error('未知请求结果')), true)
})
