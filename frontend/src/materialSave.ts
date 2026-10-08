import { ApiError, type Dispositions, type Material, type MaterialCategory, type MaterialValues, type MaterialField } from './api.ts'
import type { Fields } from './autosave.ts'
import { materialPayload } from './autosaveFields.ts'

const locations = ['company_finished', 'company_wip', 'company_raw', 'supplier_finished', 'supplier_wip', 'supplier_raw', 'supplier_rma', 'customer_return', 'customer_site', 'customer_spares']
const choices = ['', 'Use-up', 'Scrap', 'Rework', 'No Change', 'Balance', 'NA']
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

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

// Complete the display snapshot, never the PATCH. Removed positions must clear
// both controls without resetting/remounting the form on each keystroke.
export function materialFormValues(values: Fields, previous: Dispositions = {}): Partial<MaterialValues> {
  const next = materialPayload(values)
  const keys = new Set([...Object.keys(previous), ...Object.keys(next.dispositions ?? {})])
  return { ...next, dispositions: Object.fromEntries([...keys].map((key) => [key, {
    disposition: next.dispositions?.[key]?.disposition ?? '', remark: next.dispositions?.[key]?.remark ?? '',
  }])) }
}
