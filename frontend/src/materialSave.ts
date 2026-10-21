import { ApiError, type Dispositions, type Material, type MaterialCategory, type MaterialValues, type MaterialField } from './api.ts'
import type { Fields } from './autosave.ts'
import { materialFields, materialPayload } from './autosaveFields.ts'

const locations = ['company_finished', 'company_wip', 'company_raw', 'supplier_finished', 'supplier_wip', 'supplier_raw', 'supplier_rma', 'customer_return', 'customer_site', 'customer_spares']
const choices = ['', 'Use-up', 'Scrap', 'Rework', 'No Change', 'Balance', 'NA']
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

type MaterialPayload = Partial<MaterialValues> & { category?: MaterialCategory; request_id?: string }
export type MaterialWriteState = { id?: number; creation?: MaterialPayload }

export async function saveMaterial(state: MaterialWriteState, category: MaterialCategory, fields: MaterialField[], patch: Fields,
  send: (id: number | undefined, payload: MaterialPayload) => Promise<unknown>): Promise<Material> {
  if (state.id !== undefined) return checkedMaterial(await send(state.id, materialPayload(patch)), category, fields, state.id)
  // 先用冻结的载荷确认原创建、取得物料ID，再PATCH响应丢失期间的新修改。
  state.creation ??= { ...materialPayload(patch), category, request_id: crypto.randomUUID() }
  let created: Material
  try { created = checkedMaterial(await send(undefined, state.creation), category, fields) }
  catch (failure) { if (failure instanceof ApiError && failure.status === 400) state.creation = undefined; throw failure }
  state.id = created.id; state.creation = undefined
  const saved = materialFields(created, fields)
  const changed = Object.fromEntries(Object.entries(patch).filter(([key, value]) => saved[key] !== value))
  return Object.keys(changed).length ? checkedMaterial(await send(state.id, materialPayload(changed)), category, fields, state.id) : created
}

export function checkedMaterials(value: unknown): Material[] {
  const fields: MaterialField[] = ['material_no', 'description', 'material_class', 'old_revision', 'new_revision', 'revision', 'detailed_class', 'discontinued_project', 'change_description']
  if (!Array.isArray(value) || new Set(value.map(row => row?.id)).size !== value.length) throw new ApiError(200, '物料列表响应不完整，请重试。')
  for (const row of value) {
    if (!row || !['revision', 'addition', 'discontinuation'].includes(row.category)) throw new ApiError(200, '物料列表响应不完整，请重试。')
    checkedMaterial(row, row.category, fields)
  }
  return value
}

export function checkedMaterial(value: unknown, category: MaterialCategory, fields: MaterialField[], expectedId?: number): Material {
  const valid = object(value) && Number.isSafeInteger(value.id) && Number(value.id) > 0
    && (expectedId === undefined || value.id === expectedId) && value.category === category
    && fields.every((key) => typeof value[key] === 'string')
    && ['', 'Y', 'N'].includes(String(value.spare_part)) && ['', 'Y', 'N'].includes(String(value.optional_part))
    && object(value.dispositions) && (category !== 'addition' || !Object.keys(value.dispositions).length)
    && Object.entries(value.dispositions).every(([key, cell]) => locations.includes(key) && object(cell)
      && Object.keys(cell).every((field) => field === 'disposition' || field === 'remark')
      && typeof cell.disposition === 'string' && choices.includes(cell.disposition) && typeof cell.remark === 'string')
  if (!valid) throw new ApiError(200, '服务器返回的物料格式异常，保存结果未确认。请保留填写内容后重试。')
  return value as Material
}

// 这里只补齐显示用的快照，不扩展PATCH；清空控件时保留正在编辑的表单实例。
export function materialFormValues(values: Fields, previous: Dispositions = {}): Partial<MaterialValues> {
  const next = materialPayload(values)
  const keys = new Set([...Object.keys(previous), ...Object.keys(next.dispositions ?? {})])
  return { ...next, dispositions: Object.fromEntries([...keys].map((key) => [key, {
    disposition: next.dispositions?.[key]?.disposition ?? '', remark: next.dispositions?.[key]?.remark ?? '',
  }])) }
}
