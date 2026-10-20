import { ApiError, type QuestionData } from './api.ts'

export function checkedQuestions(value: unknown): QuestionData {
  const data = value as QuestionData | null
  if (!data || typeof data.updated_at !== 'string' || !Number.isFinite(Date.parse(data.updated_at)) || !Array.isArray(data.questions) || data.questions.length !== 27
    || new Set(data.questions.map(row => row?.number)).size !== 27
    || !data.questions.every(row => row && Number.isInteger(row.number) && row.number >= 1 && row.number <= 27
      && ['', 'Y', 'N'].includes(row.answer) && ['function', 'text', 'remark'].every(key => typeof row[key as 'text'] === 'string')
      && (row.remark_hint === null || row.remark_hint && ['', 'Y', 'N'].includes(row.remark_hint.answer) && typeof row.remark_hint.text === 'string'))) {
    throw new ApiError(200, '问题评估响应不完整，请保留填写内容后重试。')
  }
  return data
}

export function saveResultUnconfirmed(error: unknown): boolean {
  // Rejections such as 400/403/409 confirm that this request was not applied.
  // Network loss, server/proxy failures, or an unreadable success do not.
  return !(error instanceof ApiError) || error.status === 0 || error.status >= 500 || (error.status >= 200 && error.status < 300)
}
