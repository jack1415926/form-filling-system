import { ApiError, type ChangeRequest } from './api.ts'
import { newestResponse } from './latestResponse.ts'
import { saveResultUnconfirmed } from './questionDraft.ts'
import { canEdit } from './workflow.ts'

export type Reviewer = { id: number; username: string; display_name: string }
export type SubmissionPayload = { review_mode: 'designated' | 'public'; reviewer_ids: number[]; expected_round?: number; request_id?: string }
export type SubmissionData = { change: ChangeRequest; reviewers: Reviewer[]; request_id?: string | null }
export const submissionChoiceWarning = '审核方式和人员尚未提交，只保留在当前页面；离开后需要重新选择。尚未发送的反馈或修改说明也会丢失。'
export const modeLabel = (mode: ChangeRequest['review_mode']) => mode === 'designated' ? '指定审核' : mode === 'public' ? '公开审核' : '未记录'
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value))

export function checkedChange(value: unknown, owner: { id: number; applicant?: number }): ChangeRequest {
  if (!object(value) || value.id !== owner.id || !Number.isSafeInteger(value.applicant) || Number(value.applicant) <= 0
      || owner.applicant !== undefined && value.applicant !== owner.applicant
      || typeof value.status !== 'string' || !['draft', 'pending', 'approved', 'returned'].includes(value.status) || typeof value.review_mode !== 'string' || !['', 'designated', 'public'].includes(value.review_mode)
      || !Number.isSafeInteger(value.current_review_round) || Number(value.current_review_round) < 0
      || !date(value.updated_at) || !date(value.created_at) || !(value.submitted_at === null || date(value.submitted_at))
      || !['title', 'ecr_no', 'eco_no', 'affected_products', 'affected_region', 'initiating_factory', 'affected_factories', 'ccb_owner', 'change_owner', 'change_reason'].every((key) => typeof value[key] === 'string')
      || !(value.planned_eco_date === null || date(value.planned_eco_date))) throw new ApiError(200, '申请响应不完整，操作结果未确认。')
  return value as ChangeRequest
}

export function checkedReviewers(value: unknown): Reviewer[] {
  if (!Array.isArray(value) || !value.every((row) => object(row) && Number.isSafeInteger(row.id) && Number(row.id) > 0 && typeof row.username === 'string' && typeof row.display_name === 'string')
      || new Set(value.map((row) => row.id)).size !== value.length) throw new ApiError(200, '审核员名单响应格式异常，请重试。')
  return value as Reviewer[]
}

export function checkedSubmission(value: unknown, owner: Pick<ChangeRequest, 'id' | 'applicant'>, payload?: SubmissionPayload): SubmissionData {
  const invalid = () => { throw new ApiError(200, '提交响应格式异常，提交结果未确认。请查询结果或按原请求重试。') }
  if (!object(value) || !object(value.change)) return invalid()
  const row = value.change
  try { checkedChange(row, owner) } catch { return invalid() }
  const reviewers = checkedReviewers(value.reviewers)
  const legacy = row.review_mode === '' && row.submitted_at === null && reviewers.length === 0
  const returnedConfirmation = row.status === 'returned' && payload?.request_id && value.request_id === payload.request_id
    && row.current_review_round === (payload.expected_round ?? 0) + 1
  if (row.status === 'draft' ? !legacy : !(legacy || date(row.submitted_at) && (row.review_mode === 'designated' ? reviewers.length > 0 : row.review_mode === 'public' && reviewers.length === 0))) return invalid()
  if (payload && (row.status === 'draft' || row.status === 'returned' && !returnedConfirmation || !date(row.submitted_at) || row.review_mode !== payload.review_mode
      || payload.request_id && value.request_id !== payload.request_id
      || reviewers.map((person) => person.id).sort((a, b) => a - b).join(',') !== [...payload.reviewer_ids].sort((a, b) => a - b).join(','))) return invalid()
  return value as SubmissionData
}

export function newestSubmission(current: SubmissionData | undefined, incoming: SubmissionData): SubmissionData {
  return current && newestResponse(current.change, incoming.change) === current.change ? current : incoming
}

export async function recoverSubmissionFailure({ failure, payload, previousUnknown, owner, cached, read, accept }: {
  failure: unknown; payload: SubmissionPayload; previousUnknown: boolean; owner: Pick<ChangeRequest, 'id' | 'applicant'>
  cached: () => SubmissionData | undefined; read: () => Promise<unknown>; accept: (data: SubmissionData) => SubmissionData
}): Promise<{ unknown: SubmissionPayload | null; error: string | null; refreshReviewers: boolean }> {
  const message = failure instanceof Error ? failure.message : String(failure)
  const confirmed = (data: SubmissionData) => {
    const latest = accept(data)
    let error = null
    try { checkedSubmission(latest, owner, payload) }
    catch { error = '申请已锁定，但提交信息与原请求不同，请核对页面显示的审核方式和人员。' }
    return { unknown: null, error, refreshReviewers: false }
  }
  const known = cached()
  if (known && (!canEdit(known.change) || submissionConfirmed(known, owner, payload))) return confirmed(known)
  if (saveResultUnconfirmed(failure)) return { unknown: payload, error: `提交结果未确认，保留原请求。${message}`, refreshReviewers: false }
  // A definite retry rejection must reconcile the earlier unknown result before allowing edits.
  try {
    const data = checkedSubmission(await read(), owner)
    const latest = accept(newestSubmission(cached(), data))
    if (!canEdit(latest.change) || submissionConfirmed(latest, owner, payload)) return confirmed(latest)
    return { unknown: null, error: message, refreshReviewers: true }
  } catch (readFailure) {
    const latest = cached()
    if (latest && (!canEdit(latest.change) || submissionConfirmed(latest, owner, payload))) return confirmed(latest)
    return { unknown: previousUnknown ? payload : null, error: `${message}；提交状态核对失败：${readFailure instanceof Error ? readFailure.message : String(readFailure)}`, refreshReviewers: false }
  }
}

export function submissionConfirmed(data: SubmissionData, owner: Pick<ChangeRequest, 'id' | 'applicant'>, payload: SubmissionPayload): boolean {
  try { checkedSubmission(data, owner, payload); return true } catch { return false }
}

export function submissionError(record: ChangeRequest, mode: '' | SubmissionPayload['review_mode'], ids: number[], reviewers: Reviewer[]): string | null {
  if (!record.title.trim() || !record.ecr_no.trim()) return '提交前必须填写标题和 ECR 编号，请返回概述补齐。'
  if (!mode) return '请选择审核方式。'
  if (mode === 'public') return reviewers.length < 2 ? '系统中的有效审核员不足两人，请联系账号维护人员设置审核员身份。' : null
  if (!ids.length) return '指定审核至少选择一名审核员。'
  if (new Set(ids).size !== ids.length || ids.some((id) => !reviewers.some((person) => person.id === id))) return '所选审核员已失效，请重新选择。'
  return null
}
