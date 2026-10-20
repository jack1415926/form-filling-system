import { ApiError } from './api.ts'

export type Mark = '' | 'X' | '(X)'
export type Cell = { mark: Mark; remark: string }
export type Matrix = {
  title: string; introduction: string; legend: string; definitions: string
  rows: { id: string; label: string }[]
  tests: { id: string; label: string; group: string; standard: string }[]
  cells: Record<string, Cell>
}
export type EmcData = Matrix & { updated_at: string; initialized: boolean; can_fill: boolean }
export type EmcPatch = { cells: Record<string, Partial<Cell>> }
export function checkedEmc(value: unknown): EmcData {
  const data = value as EmcData | null
  if (!data || typeof data.updated_at !== 'string' || !Number.isFinite(Date.parse(data.updated_at)) || typeof data.initialized !== 'boolean' || typeof data.can_fill !== 'boolean'
    || !['title', 'introduction', 'legend', 'definitions'].every(key => typeof data[key as 'title'] === 'string')
    || !Array.isArray(data.rows) || !data.rows.length || !Array.isArray(data.tests) || !data.tests.length
    || !data.rows.every(row => row && typeof row.id === 'string' && !!row.id && typeof row.label === 'string')
    || !data.tests.every(test => test && ['id', 'label', 'group', 'standard'].every(key => typeof test[key as 'id'] === 'string') && !!test.id)
    || new Set(data.rows.map(row => row.id)).size !== data.rows.length || new Set(data.tests.map(test => test.id)).size !== data.tests.length
    || !data.cells || typeof data.cells !== 'object' || Array.isArray(data.cells)
    || !Object.entries(data.cells).every(([key, cell]) => data.rows.some(row => data.tests.some(test => key === `${row.id}/${test.id}`))
      && cell && ['', 'X', '(X)'].includes(cell.mark) && typeof cell.remark === 'string')) throw new ApiError(200, 'EMC响应不完整，请保留填写内容后重试。')
  return data
}
export const cellKey = (row: string, test: string) => `${row}/${test}`
export const testName = (label: string) => label.split('\n').find((line) => /[A-Za-z\u4e00-\u9fff]/.test(line)) ?? label

export function matrixHeaderGroups(tests: Matrix['tests']) {
  const groups: { label: string; bands: { label: string; tests: Matrix['tests'] }[] }[] = []
  for (const test of tests) {
    const label = test.group || '未分组'
    if (groups.at(-1)?.label !== label) groups.push({ label, bands: [] })
    const group = groups.at(-1)!
    const standard = test.standard.match(/^IEC\s*1000-4(-\d+)$/)?.[1] ?? (test.standard || '未注明标准')
    if (group.bands.at(-1)?.label !== standard) group.bands.push({ label: standard, tests: [] })
    group.bands.at(-1)!.tests.push(test)
  }
  return groups
}
