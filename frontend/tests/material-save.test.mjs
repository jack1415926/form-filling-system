import assert from 'node:assert/strict'
import { test } from 'node:test'
import { materialFormValues, checkedMaterial } from '../src/materialSave.ts'
import { materialFields, materialPayload } from '../src/autosaveFields.ts'
import { Autosave } from '../src/autosave.ts'
import { saveResultUnconfirmed } from '../src/questionDraft.ts'

const keys = ['material_no', 'description', 'material_class', 'spare_part', 'optional_part', 'revision', 'detailed_class']
const valid = { id: 7, category: 'addition', material_no: '001', description: 'saved', material_class: '', spare_part: '', optional_part: '', revision: '', detailed_class: '', dispositions: {} }

test('deleted disposition controls clear without adding them to a later description-only PATCH', () => {
  const baseline = materialFields({ ...valid, dispositions: {} }, keys)
  const form = materialFormValues(baseline, { company_finished: { disposition: 'NA', remark: 'old' } })
  assert.deepEqual(form.dispositions, { company_finished: { disposition: '', remark: '' } })
  const queue = new Autosave(baseline, async () => baseline, () => {})
  queue.configure(false, true, false)
  queue.update(materialFields({ ...form, description: 'new' }, keys))
  assert.deepEqual(materialPayload(queue.patch), { description: 'new' }); queue.dispose()
})

test('display projection preserves current protected input and clears only absent fields', () => {
  const fields = { description: 'local', 'supplier_rma.remark': 'local note', 'company_finished.disposition': 'Rework' }
  const form = materialFormValues(fields, { supplier_rma: { disposition: 'NA', remark: 'old' }, company_finished: { remark: 'old' } })
  assert.deepEqual(form, { description: 'local', dispositions: { supplier_rma: { disposition: '', remark: 'local note' }, company_finished: { disposition: 'Rework', remark: '' } } })
})

test('material confirmation rejects empty/partial/wrong types, identity, category and disposition structures', () => {
  const invalid = [{}, [], null, { ...valid, id: 0 }, { ...valid, id: '7' }, { ...valid, id: 1.5 }, { ...valid, id: 8 }, { ...valid, category: 'revision' }, { ...valid, description: undefined }, { ...valid, owner: 1, description: 1 }, { ...valid, spare_part: 'yes' }, { ...valid, dispositions: [] }, { ...valid, dispositions: { unknown: { disposition: 'NA', remark: '' } } }, { ...valid, dispositions: { company_finished: { disposition: 'NA', remark: '' } } }]
  for (const value of invalid) assert.throws(() => checkedMaterial(value, 'addition', keys, 7), (error) => saveResultUnconfirmed(error))
  assert.equal(checkedMaterial(valid, 'addition', keys, 7), valid)
  assert.equal(checkedMaterial(valid, 'addition', keys), valid)
  const revision = { ...valid, category: 'revision', old_revision: 'A', new_revision: 'B', change_description: '', dispositions: { company_finished: { disposition: 'NA', remark: '' } } }
  const revisionKeys = ['material_no', 'description', 'material_class', 'spare_part', 'optional_part', 'old_revision', 'new_revision', 'change_description']
  assert.equal(checkedMaterial(revision, 'revision', revisionKeys, 7), revision)
  for (const cell of [{}, { disposition: 'bad', remark: '' }, { disposition: 'NA', remark: 5 }, { disposition: 'NA', remark: '', extra: '' }]) assert.throws(() => checkedMaterial({ ...revision, dispositions: { company_finished: cell } }, 'revision', revisionKeys, 7))
})

test('malformed material success keeps draft and involved fields unconfirmed; normal retry confirms them', async () => {
  let result = {}
  const queue = new Autosave(materialFields({ ...valid, material_no: '', description: '' }, keys), async () => materialFields(checkedMaterial(result, 'addition', keys), keys), () => {})
  queue.configure(false, true, false); queue.update({ material_no: '001', description: 'must preserve' })
  await assert.rejects(queue.flush(true))
  assert.equal(queue.values.description, 'must preserve'); assert.equal(queue.dirty, true); assert(queue.unconfirmed.has('description'))
  result = { ...valid, description: 'must preserve' }; await queue.flush(true)
  assert.equal(queue.dirty, false); assert.equal(queue.error, null); queue.dispose()
})
