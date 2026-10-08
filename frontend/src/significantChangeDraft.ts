import type { Fields } from './autosave'
import definition from '../../backend/changes/significant_change.json' with { type: 'json' }

export type Option = { value: string; label: string }
export type ChartValues = { applicability: string; reason: string; result: string }
export type ChartRow = ChartValues & { id: string; text: string; next_steps: Record<string, string>; result_options: Option[]; validation_hint: string }
export type SubValues = { answer: string; reason: string }
export type SubRow = SubValues & { id: string; number: string; chart: string; text: string; source_title: string; yes_result: string; no_result: string }
export type AssessmentValues = { f_assessment: string; final_conclusion: string }
export type SignificantData = {
  updated_at: string; title: string; assessment: AssessmentValues; charts: ChartRow[]; questions: SubRow[]
  f_text: string; f_options: Option[]; final_options: Option[]
}

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const texts = (value: unknown, keys: string[]) => object(value) && keys.every((key) => typeof value[key] === 'string')
const options = (value: unknown) => Array.isArray(value) && value.every((option) => texts(option, ['value', 'label']))
const chartIds = definition.charts.map((row) => row.id)
const questionDefinitions = new Map(definition.questions.map((row) => [row.id, row]))
function completeIds(value: unknown, ids: string[]): boolean {
  return Array.isArray(value) && value.length === ids.length
    && value.every((row) => object(row) && typeof row.id === 'string' && ids.includes(row.id))
    && new Set(value.map((row) => row.id)).size === ids.length
}

export function significantFields(data: SignificantData, expected?: Fields): Fields {
  // Validate the fixed contract even on a cold GET, before accepting a cache baseline.
  const valid = texts(data, ['updated_at', 'title', 'f_text']) && Number.isFinite(Date.parse(data.updated_at))
    && texts(data.assessment, ['f_assessment', 'final_conclusion']) && options(data.f_options) && options(data.final_options)
    && completeIds(data.charts, chartIds) && completeIds(data.questions, [...questionDefinitions.keys()])
    && data.charts.every((row) => texts(row, ['text', 'applicability', 'reason', 'result', 'validation_hint'])
      && texts(row.next_steps, ['Y', 'N']) && options(row.result_options))
    && data.questions.every((row) => {
      const fixed = questionDefinitions.get(row.id)
      return texts(row, ['number', 'chart', 'text', 'source_title', 'answer', 'reason', 'yes_result', 'no_result'])
        && row.number === fixed?.number && row.chart === fixed?.chart
    })
  if (!valid) throw new Error('评估响应不完整，保存结果未确认。')
  const fields = Object.fromEntries([
    ...['f_assessment', 'final_conclusion'].map((field) => [`assessment.${field}`, data.assessment?.[field as keyof AssessmentValues]]),
    ...data.charts.flatMap((row) => (row.id === '0' ? ['applicability', 'reason'] : ['applicability', 'reason', 'result']).map((field) => [`chart_${row.id}.${field}`, row[field as keyof ChartValues]])),
    ...data.questions.flatMap((row) => ['answer', 'reason'].map((field) => [`${row.id}.${field}`, row[field as keyof SubValues]])),
  ])
  if (Object.values(fields).some((value) => typeof value !== 'string')
      || expected && (Object.keys(fields).length !== Object.keys(expected).length || Object.keys(expected).some((key) => !(key in fields)))) {
    throw new Error('评估响应不完整，保存结果未确认。')
  }
  return fields
}

export function significantPayload(patch: Fields) {
  const payload: { assessment?: Partial<AssessmentValues>; charts?: Record<string, Partial<ChartValues>>; questions?: Record<string, Partial<SubValues>> } = {}
  for (const [key, value] of Object.entries(patch)) {
    const [id, field] = key.split('.')
    if (id === 'assessment') Object.assign(payload.assessment ??= {}, { [field]: value })
    else if (id.startsWith('chart_')) Object.assign((payload.charts ??= {})[id.slice(6)] ??= {}, { [field]: value })
    else Object.assign((payload.questions ??= {})[id] ??= {}, { [field]: value })
  }
  return payload
}

export const subResult = (row: SubRow, answer: string | null | undefined) => answer === 'Y' ? row.yes_result : answer === 'N' ? row.no_result : ''

export function conclusionHint(row: ChartRow, applicability: string): string {
  const notApplicable = '不适用时请选择 N/A。'
  const applicable = `适用时，请根据子表评估选择${row.result_options.filter((option) => option.value !== 'not_applicable').map((option) => `“${option.label}”`).join('或')}。`
  return applicability === 'N' ? notApplicable : applicability === 'Y' ? applicable : `${notApplicable}${applicable}`
}

export function needsConclusionReview(values: Fields, patch: Fields): boolean {
  return Object.entries(patch).some(([key, value]) => value !== values[key] && (key.endsWith('.answer') || key.endsWith('.reason') || key.endsWith('.applicability')))
    && Object.entries(values).some(([key, value]) => !!value && (key.endsWith('.result') || key === 'assessment.final_conclusion'))
}
