import { ApiError, type Question, type QuestionData } from './api.ts'

export type QuestionPatch = Record<string, Partial<Pick<Question, 'answer' | 'remark'>>>

export function questionPatch(baseline: QuestionData, values: QuestionData, unconfirmed: QuestionPatch = {}): QuestionPatch {
  const responses: QuestionPatch = {}
  values.questions.forEach((row, index) => {
    const previous = baseline.questions[index]
    const fields: QuestionPatch[string] = {}
    for (const key of ['answer', 'remark'] as const) {
      if (row[key] !== previous[key] || key in (unconfirmed[String(row.number)] ?? {})) {
        // Retry the user's current value, including a return to the old baseline.
        Object.assign(fields, { [key]: row[key] })
      }
    }
    if (Object.keys(fields).length) responses[String(row.number)] = fields
  })
  return responses
}

export function saveResultUnconfirmed(error: unknown): boolean {
  // Rejections such as 400/403/409 confirm that this request was not applied.
  // Network loss, server/proxy failures, or an unreadable success do not.
  return !(error instanceof ApiError) || error.status === 0 || error.status >= 500 || (error.status >= 200 && error.status < 300)
}
