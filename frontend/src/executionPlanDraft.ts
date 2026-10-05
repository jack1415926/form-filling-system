import type { Fields } from './autosave'

export type PlanValues = { owner: string; start_date: string | null; end_date: string | null; remark: string }
export type PlanRow = PlanValues & { id: string; activity: string }
export type PlanData = { updated_at: string; rows: PlanRow[] }
export type PlanField = keyof PlanValues
const fields: PlanField[] = ['owner', 'start_date', 'end_date', 'remark']

export const executionPlanFields = (data: PlanData): Fields => Object.fromEntries(data.rows.flatMap((row) => fields.map((field) => [`${row.id}.${field}`, row[field]])))

export function executionPlanPayload(patch: Fields): { responses: Record<string, Partial<PlanValues>> } {
  const responses: Record<string, Partial<PlanValues>> = {}
  for (const [key, value] of Object.entries(patch)) {
    const [id, field] = key.split('.')
    Object.assign(responses[id] ??= {}, { [field]: value })
  }
  return { responses }
}

export function invalidPlanRows(values: Fields, rows: Pick<PlanRow, 'id'>[], incomplete: ReadonlySet<string> = new Set()): string[] {
  return rows.filter(({ id }) => {
    const start = values[`${id}.start_date`], end = values[`${id}.end_date`]
    return incomplete.has(`${id}.start_date`) || incomplete.has(`${id}.end_date`) || !!(start && end && end < start)
  }).map(({ id }) => id)
}
