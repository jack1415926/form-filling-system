import { ApiError, type ChangeRequest } from './api.ts'
import { checkedChange, type Reviewer } from './submission.ts'

export type RoundInfo = {
  number: number; title: string; ecr_no: string; eco_no: string; review_mode: 'designated' | 'public'; state: 'pending' | 'approved' | 'returned'
  submitted_at: string; approved_at: string | null; returned_at: string | null; returned_by: Reviewer | null; return_reason: string
  reviewers: Reviewer[]; approvals: (Reviewer & { approved_at: string })[]
}
export type Feedback = { id: number; round_number: number; author: Reviewer; request_id: string; text: string; created_at: string }
export type ReviewData = { change_id: number; updated_at: string; current_round: number; round: RoundInfo; is_current: boolean; can_view_form: boolean; can_approve: boolean; can_return: boolean; can_feedback: boolean; form: ChangeRequest | null; history: RoundInfo[]; feedback: Feedback[] }
export type ReviewAction = { kind: 'approve' | 'return' | 'feedback'; text?: string; request_id?: string }
export const reviewStateLabels = { pending: '待审核', returned: '已退回', approved: '已批准' }
export const reviewPath = (id: number, number: number) => `/api/changes/${id}/review-rounds/${number}/`
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value))
const person = (value: unknown) => object(value) && Number.isSafeInteger(value.id) && Number(value.id) > 0 && typeof value.username === 'string' && typeof value.display_name === 'string'
function validRound(value: unknown): boolean {
  return object(value) && Number.isSafeInteger(value.number) && Number(value.number) > 0
    && ['title', 'ecr_no', 'eco_no', 'return_reason'].every((key) => typeof value[key] === 'string')
    && typeof value.review_mode === 'string' && ['public', 'designated'].includes(value.review_mode) && typeof value.state === 'string' && ['pending', 'approved', 'returned'].includes(value.state)
    && date(value.submitted_at) && (value.approved_at === null || date(value.approved_at)) && (value.returned_at === null || date(value.returned_at))
    && (value.returned_by === null || person(value.returned_by)) && Array.isArray(value.reviewers) && value.reviewers.every(person)
    && Array.isArray(value.approvals) && value.approvals.every((row) => person(row) && date(row.approved_at))
}
export function checkedReview(value: unknown, id: number, number: number): ReviewData {
  let formValid = object(value) && value.form === null
  if (object(value) && value.form !== null) {
    try { formValid = checkedChange(value.form, { id }).current_review_round === value.current_round } catch { formValid = false }
  }
  const valid = object(value) && value.change_id === id && date(value.updated_at) && Number.isSafeInteger(value.current_round)
    && validRound(value.round) && (value.round as RoundInfo).number === number
    && ['is_current', 'can_view_form', 'can_approve', 'can_return', 'can_feedback'].every((key) => typeof value[key] === 'boolean')
    && Array.isArray(value.history) && value.history.every(validRound)
    && Array.isArray(value.feedback) && value.feedback.every((row) => object(row) && Number.isSafeInteger(row.id) && person(row.author) && typeof row.request_id === 'string' && typeof row.text === 'string' && date(row.created_at))
    && formValid
    && (!value.can_view_form || object(value.form))
  if (!valid) throw new ApiError(200, '审核响应不完整，操作结果未确认。请刷新当前轮次核对。')
  return value as ReviewData
}
export function actionConfirmed(action: ReviewAction, data: ReviewData, actorId: number): boolean {
  if (action.kind === 'approve') return data.round.approvals.some((row) => row.id === actorId)
  if (action.kind === 'return') return data.round.returned_by?.id === actorId && data.round.return_reason === action.text
  return data.feedback.some((row) => row.author.id === actorId && row.request_id === action.request_id)
}
