import { ApiError, type ChangeRequest } from './api.ts'
import { checkedChange } from './submission.ts'

export type FillerPerson = { id: number; username: string; display_name: string; is_active: boolean }
export type FillerReceipt = { actor_id: number | null; change_id: number; request_id: string | null; filler_id: number; previous_filler_id: number | null; kind: 'baseline' | 'create' | 'transfer'; created_at: string }
export type FillerEvent = FillerReceipt & { actor: FillerPerson | null; previous_filler: FillerPerson | null; filler: FillerPerson }
export type FillerData = { actor_id: number; change_id: number; change: ChangeRequest; filler: FillerPerson; can_transfer: boolean; history: FillerEvent[] }
export type TransferPayload = { request_id: string; filler_id: number; expected_filler_id: number; expected_updated_at: string }
const id = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0
const uuid = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const person = (value: FillerPerson | null) => !!value && id(value.id) && typeof value.username === 'string' && typeof value.display_name === 'string' && typeof value.is_active === 'boolean'
export function checkedFillerReceipt(value: unknown, changeId: number, actor?: number, operation?: Pick<TransferPayload, 'request_id' | 'filler_id'>): FillerReceipt {
  const row = value as FillerReceipt | null
  if (!row || row.change_id !== changeId || !id(row.filler_id) || !['baseline', 'create', 'transfer'].includes(row.kind)
    || typeof row.created_at !== 'string' || !Number.isFinite(Date.parse(row.created_at))
    || (row.previous_filler_id !== null && !id(row.previous_filler_id))
    || (row.kind === 'transfer' ? !id(row.previous_filler_id) : row.previous_filler_id !== null)
    || (row.kind === 'baseline' ? row.actor_id !== null || row.request_id !== null : !id(row.actor_id) || !uuid(row.request_id))
    || actor !== undefined && row.actor_id !== actor
    || operation && (row.request_id !== operation.request_id || row.filler_id !== operation.filler_id)) throw new ApiError(200, 'ECO人员操作回执不完整，结果未确认。')
  return row
}
export function checkedFillerData(value: unknown, changeId: number, actor: number): FillerData {
  const data = value as FillerData | null
  if (!data || data.actor_id !== actor || data.change_id !== changeId || !person(data.filler) || typeof data.can_transfer !== 'boolean' || !Array.isArray(data.history)) throw new ApiError(200, 'ECO填写人响应不完整，请刷新。')
  const change = checkedChange(data.change, { id: changeId, applicant: data.filler.id })
  if (change.stage !== 'eco' || data.can_transfer && !['draft', 'returned'].includes(change.status)) throw new ApiError(200, 'ECO填写状态响应不完整。')
  for (const event of data.history) {
    checkedFillerReceipt(event, changeId)
    if (!person(event.filler) || event.filler.id !== event.filler_id || (event.actor_id === null ? event.actor !== null : !person(event.actor) || event.actor!.id !== event.actor_id)
      || (event.previous_filler_id === null ? event.previous_filler !== null : !person(event.previous_filler) || event.previous_filler!.id !== event.previous_filler_id)) throw new ApiError(200, 'ECO交接历史响应不完整。')
  }
  return data
}
