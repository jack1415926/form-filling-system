import { ApiError, type ChangeRequest } from './api.ts'

export type Reviewer = { id: number; username: string; display_name: string }
export const submissionChoiceWarning = '人员分配尚未提交，只保留在当前页面；离开后需要重新选择。尚未发送的审核意见或回应也会丢失。'
export const modeLabel = (mode: ChangeRequest['review_mode']) => mode === 'designated' ? '指定审核' : '未记录'
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value))

export function checkedChange(value: unknown, owner: { id: number; applicant?: number }): ChangeRequest {
  if (!object(value) || value.id !== owner.id || !Number.isSafeInteger(value.applicant) || Number(value.applicant) <= 0
      || owner.applicant !== undefined && value.applicant !== owner.applicant
      || value.stage_approver_ids !== undefined && (!Array.isArray(value.stage_approver_ids) || new Set(value.stage_approver_ids).size !== value.stage_approver_ids.length || !value.stage_approver_ids.every(id => Number.isSafeInteger(id) && Number(id) > 0))
      || typeof value.status !== 'string' || !['draft', 'pending', 'approved', 'returned', 'published'].includes(value.status) || typeof value.review_mode !== 'string' || !['', 'designated'].includes(value.review_mode)
      || !Number.isSafeInteger(value.current_review_round) || Number(value.current_review_round) < 0
      || !date(value.updated_at) || !date(value.created_at) || !(value.submitted_at === null || date(value.submitted_at))
      || !['title', 'ecr_no', 'eco_no', 'affected_products', 'affected_region', 'initiating_factory', 'affected_factories', 'ccb_owner', 'change_owner', 'change_reason'].every((key) => typeof value[key] === 'string')
      || !(value.planned_eco_date === null || date(value.planned_eco_date))) throw new ApiError(200, '申请响应不完整，操作结果未确认。')
  return value as ChangeRequest
}

export function checkedCreatedChange(value: unknown, applicant: number, requestId: string): ChangeRequest {
  if (!object(value) || !Number.isSafeInteger(value.id) || Number(value.id) <= 0
    || value.stage !== 'ecr' || value.creation_request_id !== requestId) throw new ApiError(200, '申请创建结果未确认，请按原请求重试。')
  return checkedChange(value, { id: Number(value.id), applicant })
}

export function checkedReviewers(value: unknown): Reviewer[] {
  if (!Array.isArray(value) || !value.every((row) => object(row) && Number.isSafeInteger(row.id) && Number(row.id) > 0 && typeof row.username === 'string' && typeof row.display_name === 'string')
      || new Set(value.map((row) => row.id)).size !== value.length) throw new ApiError(200, '审核员名单响应格式异常，请重试。')
  return value as Reviewer[]
}
