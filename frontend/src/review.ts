import { ApiError, type ChangeRequest } from './api.ts'
import { checkedChange, type Reviewer } from './submission.ts'
import { newestResponse } from './latestResponse.ts'

export type RoundInfo = {
  stage?: 'legacy' | 'ecr' | 'eco'
  required_approvers?: Reviewer[]
  tasks?: { action_key: string; owner: Reviewer; result: string; status: string; date: string | null; confirmed_at: string | null }[]
  number: number; title: string; ecr_no: string; eco_no: string; review_mode: 'designated'; state: 'pending' | 'approved' | 'returned'
  submitted_at: string; approved_at: string | null; returned_at: string | null; returned_by: Reviewer | null; return_reason: string
  reviewers: Reviewer[]; approvals: (Reviewer & { approved_at: string })[]
}
export type ReviewIssue = { id: number; tab: string; location: string; text: string; source_round: number; author: Reviewer; state: 'awaiting_reply' | 'awaiting_review' | 'resolved'; version: number; can_respond: boolean; can_resolve: boolean; can_reject: boolean; events: { kind: string; text: string; state: string; version: number; round_number: number; author_id: number; request_id: string; created_at: string }[] }
export type IssueInput = { tab?: string; location?: string; text: string; issue_id?: number; version?: number }
export type ReplyDraft = { text: string; version: number }
export function editReply(current: ReplyDraft | undefined, text: string, version: number): ReplyDraft {
  return { text, version: current?.text ? current.version : version }
}
export type ReviewData = { can_add_issue?: boolean; change_id: number; updated_at: string; current_round: number; round: RoundInfo; is_current: boolean; can_view_form: boolean; can_approve: boolean; can_return: boolean; form: ChangeRequest | null; history: RoundInfo[]; issues: ReviewIssue[]; unresolved_count: number; issue_blockers: string[]; confirmed_requests: string[] }
export function reviewChangeSnapshot(current: ChangeRequest | undefined, data: ReviewData): ChangeRequest | undefined {
  if (data.form) return newestResponse(current, { ...data.form, body_access: true })
  if (!current || !data.is_current || data.current_round !== current.current_review_round
    || data.round.state !== 'returned' || data.can_view_form) return current
  return newestResponse(current, { ...current, status: 'returned', body_access: false, updated_at: data.updated_at })
}
export type ReviewAction = { kind: 'approve' | 'return' | 'respond' | 'resolve'; request_id: string; issues?: IssueInput[]; issue_id?: number; version?: number; text?: string }
export const issueTabs = { overview: '概述', materials: '物料明细', questions: '问题评估', ecr: 'ECR 评估', eco: 'ECO 执行', emc: 'EMC 参考', 'execution-plan': '执行计划', 'significant-change': '实质性变更评估' }
export const issueStateLabels = { awaiting_reply: '待回应', awaiting_review: '待复核', resolved: '已解决' }
export const reviewStateLabels = { pending: '审核中', returned: '已退回', approved: '已批准' }
export function approvalProgress(round: RoundInfo): string {
  if (['ecr', 'eco'].includes(round.stage ?? '')) return `${round.stage?.toUpperCase()}行动已确认 ${round.tasks?.filter(task => task.confirmed_at).length ?? 0}/${round.tasks?.length ?? 0} 项 · 已批准 ${round.approvals.length}/${round.required_approvers?.length ?? 0} 人 · ${reviewStateLabels[round.state]}`
  const required = round.required_approvers?.length ?? round.reviewers.length
  const count = round.approvals.length
  if (round.state === 'approved') return `已批准 ${count}/${required} 人，本流程审核已通过。`
  if (round.state === 'returned') return '本轮已退回；重新提交后，个人批准重新计算。'
  return `已批准 ${count}/${required} 人；还需 ${Math.max(0, required - count)} 名不同审核人员同意，本流程才会通过。`
}
export function approvalBlockReason(data: ReviewData, actorId: number, draftCount: number): string | null {
  if (!data.is_current) return '这是历史轮次，请打开当前审核轮次。'
  if (data.round.state !== 'pending') return data.round.state === 'approved' ? '本流程已批准。' : '申请已退回，须由申请者修订并重新提交。'
  if (data.round.approvals.some((row) => row.id === actorId)) return '你已同意批准本轮申请，无需重复批准；请等待其他审核人员。'
  if (data.unresolved_count) return `尚有 ${data.unresolved_count} 条未解决意见，须由原提出者确认解决后才能批准。`
  if (['ecr', 'eco'].includes(data.round.stage ?? '') && data.round.tasks?.some(task => !task.confirmed_at)) return '全部行动负责人确认任务后才能批准。'
  if (!data.can_approve) return '当前账号没有本轮批准权限，请重新登录并刷新审核记录核对。'
  if (draftCount) return '存在未提交的修改意见，请先处理或删除未提交意见，再同意批准。'
  return null
}
export const reviewPath = (id: number, number: number) => `/api/changes/${id}/review-rounds/${number}/`
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value))
const person = (value: unknown) => object(value) && Number.isSafeInteger(value.id) && Number(value.id) > 0 && typeof value.username === 'string' && typeof value.display_name === 'string'
function validRound(value: unknown): boolean {
  return object(value) && (value.stage === undefined || ['legacy', 'ecr', 'eco'].includes(String(value.stage)))
    && (value.required_approvers === undefined || Array.isArray(value.required_approvers) && value.required_approvers.every(person) && new Set(value.required_approvers.map(row => row.id)).size === value.required_approvers.length)
    && (!['ecr', 'eco'].includes(String(value.stage)) || Array.isArray(value.tasks) && value.tasks.every(task => object(task) && typeof task.action_key === 'string' && new RegExp(`^${value.stage}_\\d{3}$`).test(task.action_key) && person(task.owner) && typeof task.result === 'string' && ['', 'completed', 'not_applicable', ...(value.stage === 'eco' ? ['implementation_stage'] : [])].includes(String(task.status)) && (task.date === null || date(task.date)) && (task.confirmed_at === null || date(task.confirmed_at))))
    && Number.isSafeInteger(value.number) && Number(value.number) > 0
    && ['title', 'ecr_no', 'eco_no', 'return_reason'].every((key) => typeof value[key] === 'string')
    && typeof value.review_mode === 'string' && ['designated'].includes(value.review_mode) && typeof value.state === 'string' && ['pending', 'approved', 'returned'].includes(value.state)
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
    && (value.can_add_issue === undefined || typeof value.can_add_issue === 'boolean')
    && ['is_current', 'can_view_form', 'can_approve', 'can_return'].every((key) => typeof value[key] === 'boolean')
    && Array.isArray(value.history) && value.history.every(validRound)
    && Array.isArray(value.issues) && value.issues.every((row) => object(row) && Number.isSafeInteger(row.id) && Number(row.id) > 0 && person(row.author)
      && typeof row.tab === 'string' && row.tab in issueTabs && typeof row.location === 'string' && typeof row.text === 'string'
      && Number.isSafeInteger(row.source_round) && Number(row.source_round) > 0 && Number.isSafeInteger(row.version) && Number(row.version) > 0
      && typeof row.state === 'string' && row.state in issueStateLabels && ['can_respond', 'can_resolve', 'can_reject'].every((key) => typeof row[key] === 'boolean')
      && Array.isArray(row.events) && row.events.length > 0 && row.events.every((item) => object(item) && ['return', 'respond', 'resolve'].includes(String(item.kind)) && typeof item.text === 'string' && typeof item.state === 'string' && item.state in issueStateLabels && Number.isSafeInteger(item.version) && Number(item.version) > 0 && Number.isSafeInteger(item.round_number) && Number(item.round_number) > 0 && Number.isSafeInteger(item.author_id) && typeof item.request_id === 'string' && date(item.created_at)))
    && Number.isSafeInteger(value.unresolved_count) && Number(value.unresolved_count) >= 0
    && Array.isArray(value.issue_blockers) && value.issue_blockers.every((row) => typeof row === 'string')
    && Array.isArray(value.confirmed_requests) && value.confirmed_requests.every((row) => typeof row === 'string')
    && formValid
    && (!value.can_view_form || object(value.form))
  if (!valid) throw new ApiError(200, '审核响应不完整，操作结果未确认。请刷新当前轮次核对。')
  return value as ReviewData
}
export function actionConfirmed(action: ReviewAction, data: ReviewData, actorId: number): boolean {
  return data.confirmed_requests.includes(action.request_id) && (action.kind !== 'approve' || data.round.approvals.some((row) => row.id === actorId))
}

export function actionCanRetry(action: ReviewAction, data: ReviewData): boolean {
  if (!data.is_current) return false
  if (action.kind === 'approve') return data.round.state === 'pending' && data.can_approve
  if (action.kind === 'return') return data.round.state === 'pending' && data.can_return && (action.issues ?? []).every((item) =>
    !item.issue_id || data.issues.some((issue) => issue.id === item.issue_id && issue.can_reject && issue.version === item.version))
  const issue = data.issues.find((row) => row.id === action.issue_id)
  return !!issue && issue.version === action.version && (action.kind === 'respond'
    ? data.round.state === 'returned' && issue.can_respond
    : data.round.state === 'pending' && issue.can_resolve)
}
