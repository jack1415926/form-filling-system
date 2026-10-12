import { ApiError, type ChangeRequest } from './api.ts'
import { checkedChange } from './submission.ts'
import { newestResponse } from './latestResponse.ts'

export type PublicationData = { actor_id: number; change: ChangeRequest; publisher_name: string; publisher_active: boolean; can_publish: boolean; can_create_eco: boolean; eco_id: number | null }
export type PublicationOperation = { kind: 'publish'; request_id: string; expected_round: number } | { kind: 'create'; request_id: string }
const id = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0
const uuid = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
export function checkedPublication(value: unknown, changeId: number, actor: number): PublicationData {
  const data = value as PublicationData | null
  const invalid = () => { throw new ApiError(200, '发布响应不完整，操作结果未确认，请查询或重试。') }
  if (!data || data.actor_id !== actor || typeof data.publisher_name !== 'string' || typeof data.publisher_active !== 'boolean'
    || typeof data.can_publish !== 'boolean' || typeof data.can_create_eco !== 'boolean' || !(data.eco_id === null || id(data.eco_id))) return invalid()
  const change = checkedChange(data.change, { id: changeId })
  if (!['ecr', 'eco'].includes(change.stage ?? '') || (change.stage === 'ecr' ? change.source_ecr_id !== null : !(id(change.source_ecr_id) && uuid(change.eco_creation_request_id) && change.ecr_no === ''))
    || (change.status === 'published' ? !(uuid(change.publication_request_id) && id(change.published_by_id) && typeof change.published_at === 'string' && Number.isFinite(Date.parse(change.published_at)))
      : !(change.publication_request_id === null && change.published_by_id === null && change.published_at === null))
    || data.can_publish && !(change.status === 'approved' && change.publisher_id === actor && data.publisher_active)
    || data.can_create_eco && !(change.stage === 'ecr' && change.status === 'published' && change.applicant === actor && data.eco_id === null)
    || data.eco_id !== null && !(change.stage === 'ecr' && change.status === 'published' && change.applicant === actor)) return invalid()
  return data
}

export function checkedCreatedEco(value: unknown, sourceId: number, actor: number): ChangeRequest {
  const data = value as { created: boolean; change: ChangeRequest } | null
  if (!data || typeof data.created !== 'boolean' || !id(data.change?.id)) throw new ApiError(200, 'ECO创建响应不完整，请查询原请求。')
  const change = checkedChange(data.change, { id: data.change.id, applicant: actor })
  if (change.stage !== 'eco' || change.source_ecr_id !== sourceId || typeof change.source_ecr_no !== 'string'
    || !uuid(change.eco_creation_request_id) || change.ecr_no !== '') throw new ApiError(200, 'ECO来源或创建回执不完整，请查询原请求。')
  return change
}

export function publicationSettled(data: PublicationData, operation: PublicationOperation) {
  return operation.kind === 'publish' ? data.change.status === 'published' : data.eco_id !== null
}

export function newestPublication(current: PublicationData | undefined, incoming: PublicationData): PublicationData {
  if (!current) return incoming
  // Creating an ECO does not mutate the immutable source timestamp. Its link only grows.
  if (current.change.updated_at === incoming.change.updated_at) {
    const ecoId = current.eco_id ?? incoming.eco_id
    return { ...incoming, eco_id: ecoId, can_create_eco: ecoId === null && incoming.can_create_eco }
  }
  return newestResponse(current.change, incoming.change) === current.change ? current : incoming
}
