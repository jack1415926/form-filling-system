export const minDate = '2000-01-01'
export const maxDate = '2100-12-31'

export function dateError(value: string): string | null {
  if (!value) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return /^\d{0,4}(?:-\d{0,2}){0,2}$/.test(value)
      ? '日期尚未填写完整，请按 YYYY-MM-DD 补全年、月、日，或清空日期。'
      : '日期格式不正确，请按 YYYY-MM-DD 填写。'
  }
  const [year, month, day] = value.split('-').map(Number)
  if (year < 2000 || year > 2100) return '日期年份须在 2000～2100 年之间。'
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate()
  if (month < 1 || month > 12 || day < 1 || day > days) return '日期不存在，请检查月份与天数（例如 9 月只有 30 天，2 月需考虑闰年）。'
  return null
}
