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
export const cellKey = (row: string, test: string) => `${row}/${test}`
export const testName = (label: string) => label.split('\n').find((line) => /[A-Za-z\u4e00-\u9fff]/.test(line)) ?? label

export function emcPatch(baseline: Matrix, values: Matrix, unconfirmed: EmcPatch = { cells: {} }): EmcPatch {
  const cells: EmcPatch['cells'] = {}
  const keys = new Set([...Object.keys(baseline.cells), ...Object.keys(values.cells), ...Object.keys(unconfirmed.cells)])
  for (const key of keys) {
    const before = baseline.cells[key] ?? { mark: '', remark: '' }
    const after = values.cells[key] ?? { mark: '', remark: '' }
    const changed: Partial<Cell> = {}
    if (after.mark !== before.mark || 'mark' in (unconfirmed.cells[key] ?? {})) changed.mark = after.mark
    if (after.remark !== before.remark || 'remark' in (unconfirmed.cells[key] ?? {})) changed.remark = after.remark
    if (Object.keys(changed).length) cells[key] = changed
  }
  return { cells }
}

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
