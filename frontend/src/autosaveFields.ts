import type { Fields } from './autosave'
import type { Dispositions, MaterialValues, Overview, QuestionData } from './api'
import type { Cell, EmcData, EmcPatch } from './emcMatrix'

export const overviewKeys: (keyof Overview)[] = ['title', 'ecr_no', 'eco_no', 'affected_products', 'affected_region', 'initiating_factory', 'affected_factories', 'ccb_owner', 'change_owner', 'planned_eco_date', 'change_reason']
export const overviewFields = (values: Partial<Overview>): Fields => Object.fromEntries(overviewKeys.map((key) => [key, key === 'planned_eco_date' ? values[key] || null : values[key] ?? '']))
export const actionFields = (values: { owner: string; result: string; status: string; date: string | null }): Fields => ({ owner: values.owner, result: values.result, status: values.status, date: values.date })
export const questionFields = (data: QuestionData): Fields => Object.fromEntries(data.questions.flatMap((row) => [[`${row.number}.answer`, row.answer], [`${row.number}.remark`, row.remark]]))
export function questionPayload(patch: Fields) {
  const responses: Record<string, Record<string, string | null>> = {}
  for (const [key, value] of Object.entries(patch)) { const [number, field] = key.split('.'); (responses[number] ??= {})[field] = value }
  return { responses }
}
export function materialFields(values: Partial<MaterialValues>, keys: (keyof MaterialValues)[]): Fields {
  const result: Fields = Object.fromEntries(keys.map((key) => [key, values[key] as string ?? '']))
  for (const [location, value] of Object.entries(values.dispositions ?? {})) {
    result[`${location}.disposition`] = value.disposition ?? ''; result[`${location}.remark`] = value.remark ?? ''
  }
  return result
}
export function materialPayload(patch: Fields): Partial<MaterialValues> {
  const result: Partial<MaterialValues> = {}; const dispositions: Dispositions = {}
  for (const [key, value] of Object.entries(patch)) {
    if (!key.includes('.')) Object.assign(result, { [key]: value })
    else { const [location, field] = key.split('.'); Object.assign(dispositions[location] ??= {}, { [field]: value }) }
  }
  if (Object.keys(dispositions).length) result.dispositions = dispositions
  return result
}
export function emcFields(data: EmcData): Fields {
  return Object.fromEntries(Object.entries(data.cells).flatMap(([key, cell]) => [[`${key}.mark`, cell.mark], [`${key}.remark`, cell.remark]]))
}
export function emcPayload(patch: Fields): EmcPatch {
  const cells: Record<string, Partial<Cell>> = {}
  for (const [key, value] of Object.entries(patch)) {
    const index = key.lastIndexOf('.'); const cell = key.slice(0, index); const field = key.slice(index + 1)
    Object.assign(cells[cell] ??= {}, { [field]: value ?? '' })
  }
  return { cells }
}
