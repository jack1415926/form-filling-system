import assert from 'node:assert/strict'
import { test } from 'node:test'
import { overviewPatch, materialPatch } from '../src/formDraft.ts'

test('reverted overview fields are omitted while explicit date clearing is preserved', () => {
  const baseline = { title: 'original', affected_region: 'old-region', planned_eco_date: '2026-10-03' }
  assert.deepEqual(overviewPatch(baseline, { ...baseline, affected_region: 'new-region' }), { affected_region: 'new-region' })
  assert.deepEqual(overviewPatch(baseline, { ...baseline, planned_eco_date: '' }), { planned_eco_date: null })
  assert.deepEqual(overviewPatch({ ...baseline, planned_eco_date: null }, { ...baseline, planned_eco_date: '' }), {})
  assert.deepEqual(overviewPatch(baseline, baseline), {})
})

test('an unconfirmed overview save retries current reverted values and only involved fields', () => {
  const baseline = { title: 'original', affected_region: 'old-region', planned_eco_date: null }
  assert.deepEqual(overviewPatch(baseline, baseline, { title: 'possibly-committed' }), { title: 'original' })
  assert.deepEqual(overviewPatch(baseline, { ...baseline, title: '' }, { title: 'possibly-committed' }), { title: '' })
})

test('material and disposition patches preserve external fields and omit reverted edits', () => {
  const baseline = { material_no: 'original', description: 'old', dispositions: { company_finished: { disposition: 'NA', remark: 'old' } } }
  const fields = ['material_no', 'description']
  const values = { ...baseline, description: 'local', dispositions: { company_finished: { disposition: 'NA', remark: 'local-note' } } }
  const patch = materialPatch(baseline, values, fields)
  assert.deepEqual(patch, { description: 'local', dispositions: { company_finished: { remark: 'local-note' } } })
  const server = { ...baseline, material_no: 'external', dispositions: { company_finished: { disposition: 'Rework', remark: 'external-note' } } }
  Object.assign(server, { description: patch.description })
  Object.assign(server.dispositions.company_finished, patch.dispositions.company_finished)
  assert.equal(server.material_no, 'external')
  assert.equal(server.dispositions.company_finished.disposition, 'Rework')
  assert.deepEqual(materialPatch(baseline, baseline, fields), {})
})

test('material unknown results retry current values, including reverted or removed cells', () => {
  const baseline = { material_no: 'original', description: 'old', dispositions: { company_finished: { disposition: 'NA', remark: 'old' } } }
  const fields = ['material_no', 'description']
  const unconfirmed = { material_no: 'possibly-committed', dispositions: { company_finished: { remark: 'possibly-committed' } } }
  assert.deepEqual(materialPatch(baseline, baseline, fields, unconfirmed), { material_no: 'original', dispositions: { company_finished: { remark: 'old' } } })
  assert.deepEqual(materialPatch(baseline, { ...baseline, dispositions: {} }, fields), { dispositions: { company_finished: { disposition: '', remark: '' } } })
  assert.deepEqual(materialPatch(undefined, {}, fields), { material_no: '', description: '' })
})
