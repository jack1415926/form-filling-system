import { ApiError, type ChangeRequest } from './api.ts'
import { checkedChange } from './submission.ts'
import { newestResponse } from './latestResponse.ts'
import { saveResultUnconfirmed } from './questionDraft.ts'
import type { Fields } from './autosave.ts'

export type StageAction = { id: string; number: number; function: string; text: string; question_answer: string; extra_required: boolean; required: boolean; owner_user_ids?: number[]; owner_users?: { id: number; display_name: string; is_active: boolean }[]; owner_user_id: number | null; owner_name: string; owner_active: boolean }
export type StageTask = { id: number; round: number; action_key: string; owner_id: number; owner_name: string; result: string; status: '' | 'completed' | 'not_applicable' | 'implementation_stage'; date: string | null; version: number; confirmed_at: string | null; can_edit: boolean; confirmed_requests: string[] }
export type StageData = { stage: 'ecr' | 'eco'; actor_id: number; change: ChangeRequest | null; change_id: number; updated_at: string; status: ChangeRequest['status']; current_round: number; actions: StageAction[]; tasks: StageTask[]; unanswered: number[]; issue_blockers: string[]; submission_request_id: string | null; submission_requests: string[] }
export type StageSubmitPayload = { expected_round: number; request_id: string; acknowledge_no_tasks: boolean }
export type TaskPayload = { request_id: string; version: number; result?: string; status?: string; date?: string | null }
const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value))
const id = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0
export function checkedStage(value: unknown, changeId: number, actorId?: number, current?: StageData): StageData {
  const data = value as StageData | null
  const invalid = () => { throw new ApiError(200, '阶段响应不完整，操作结果未确认；请保留输入并查询。') }
  if (!data || !['ecr', 'eco'].includes(data.stage) || !id(data.actor_id) || actorId !== undefined && data.actor_id !== actorId || data.change_id !== changeId || !date(data.updated_at) || !['draft', 'pending', 'returned', 'approved', 'published'].includes(data.status)
    || !Number.isSafeInteger(data.current_round) || data.current_round < 0
    || !Array.isArray(data.tasks) || new Set(data.tasks.map(task => task?.id)).size !== data.tasks.length
    || !data.tasks.every(task => task && id(task.id) && id(task.round) && task.round <= data.current_round && new RegExp(`^${data.stage}_\\d{3}$`).test(task.action_key) && Number(task.action_key.slice(-3)) >= 1 && Number(task.action_key.slice(-3)) <= 61
      && id(task.owner_id) && typeof task.owner_name === 'string' && typeof task.result === 'string' && ['', 'completed', 'not_applicable', ...(data.stage === 'eco' ? ['implementation_stage'] : [])].includes(task.status)
      && (task.date === null || date(task.date)) && id(task.version) && (task.confirmed_at === null || date(task.confirmed_at))
      && typeof task.can_edit === 'boolean' && (!task.can_edit || task.round === data.current_round && data.status === 'pending' && task.confirmed_at === null && task.owner_id === data.actor_id)
      && Array.isArray(task.confirmed_requests) && task.confirmed_requests.every(request => typeof request === 'string'))
    || !Array.isArray(data.actions) || !Array.isArray(data.unanswered) || !data.unanswered.every(number => id(number) && number <= 27)
    || !Array.isArray(data.issue_blockers) || !data.issue_blockers.every(text => typeof text === 'string')
    || !(data.submission_request_id === null || typeof data.submission_request_id === 'string')
    || !Array.isArray(data.submission_requests) || !data.submission_requests.every(request => typeof request === 'string')) return invalid()
  if (data.change !== null) {
    const change = checkedChange(data.change, { id: changeId })
    if (change.stage !== data.stage || change.status !== data.status || change.current_review_round !== data.current_round
      || !(change.publisher_id === null || id(change.publisher_id)) || data.actions.length !== 61 || new Set(data.actions.map(action => action?.id)).size !== 61
      || !data.actions.every(action => action && new RegExp(`^${data.stage}_\\d{3}$`).test(action.id) && Number(action.id.slice(-3)) >= 1 && Number(action.id.slice(-3)) <= 61
        && id(action.number) && action.number <= 27 && typeof action.text === 'string' && typeof action.function === 'string'
        && ['', 'Y', 'N'].includes(action.question_answer) && typeof action.extra_required === 'boolean' && typeof action.required === 'boolean'
        && action.required === (action.question_answer === 'Y' || action.extra_required) && (action.owner_user_id === null || id(action.owner_user_id))
        && typeof action.owner_name === 'string' && typeof action.owner_active === 'boolean'
        && (action.owner_user_ids === undefined || Array.isArray(action.owner_user_ids) && action.owner_user_ids.every(id) && new Set(action.owner_user_ids).size === action.owner_user_ids.length
          && Array.isArray(action.owner_users) && action.owner_users.length === action.owner_user_ids.length
          && action.owner_users.every((user, index) => user && user.id === action.owner_user_ids![index] && typeof user.display_name === 'string' && typeof user.is_active === 'boolean')
          && action.owner_active === (action.owner_users.length > 0 && action.owner_users.every(user => user.is_active))))) return invalid()
  } else if (data.actions.length || data.unanswered.length) return invalid()
  return newestResponse(current, data)
}

export type TaskWriteState = { task: StageTask; pending: TaskPayload | null }
const taskFields = (task: StageTask): Fields => ({ result: task.result, status: task.status, date: task.date })

// Reconcile the frozen request before acknowledging any later edit to the queue.
export async function saveTaskPatch(state: TaskWriteState, patch: Fields, send: (payload: TaskPayload) => Promise<StageTask>): Promise<Fields> {
  const write = async (payload: TaskPayload) => {
    state.pending = payload
    try {
      const task = await send(payload)
      if (!task.confirmed_requests.includes(payload.request_id)) throw new Error('原保存请求尚未确认。')
      state.task = task; state.pending = null
      return taskFields(task)
    } catch (failure) {
      if (!saveResultUnconfirmed(failure)) state.pending = null
      throw failure
    }
  }
  if (state.pending) {
    const pending = state.pending
    const saved = await write(pending)
    if (Object.entries(patch).every(([key, value]) => saved[key] === value)) return saved
    if (!state.task.can_edit || state.task.version !== pending.version + 1) {
      throw new ApiError(409, '原请求已确认，但任务状态或版本又发生变化；新输入保留，请核对后再保存。')
    }
  }
  return write({ ...patch, version: state.task.version, request_id: crypto.randomUUID() } as TaskPayload)
}

export function taskConfirmationState(task: StageTask | undefined, payload: TaskPayload): 'confirmed' | 'retryable' | 'ended' {
  if (task?.confirmed_requests.includes(payload.request_id)) return 'confirmed'
  return task?.can_edit && task.version === payload.version ? 'retryable' : 'ended'
}

export function stageSubmissionState(data: StageData, payload: StageSubmitPayload): 'confirmed' | 'retryable' | 'ended' {
  if (data.submission_requests.includes(payload.request_id)) return 'confirmed'
  return ['draft', 'returned'].includes(data.status) && data.current_round === payload.expected_round ? 'retryable' : 'ended'
}
