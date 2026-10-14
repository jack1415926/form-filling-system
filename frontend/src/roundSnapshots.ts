import { QueryClient } from '@tanstack/react-query'
import { ApiError, type ChangeRequest, type User } from './api.ts'
import { checkedChange } from './submission.ts'
import { checkedStage, type StageAction, type StageTask } from './ecrStage.ts'

export type FormSnapshot = {
  version: 1; change_id: number; number: number; captured_at: string
  overview: ChangeRequest; actions: StageAction[]; source_overview: Record<string, string | null> | null
  sheets: Record<string, unknown>
}
export type SnapshotData = { actor_id: number; change_id: number; number: number; snapshot: FormSnapshot | null; tasks: StageTask[] }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
export const snapshotPath = (id: number, number: number) => `/api/changes/${id}/review-rounds/${number}/form-snapshot/`
export function adjacentSnapshotTab(tab: string, direction: -1 | 1): string {
  const sheets = ['overview', 'materials', 'questions', 'ecr', 'eco', 'emc', 'execution-plan', 'significant-change']
  const index = sheets.indexOf(tab)
  return index < 0 ? 'overview' : sheets[(index + direction + sheets.length) % sheets.length]
}

export function checkedSnapshot(value: unknown, actor: number, id: number, number: number): SnapshotData {
  const invalid = () => { throw new ApiError(200, '历史表单响应不完整或轮次不匹配，请重新读取。') }
  if (!object(value) || value.actor_id !== actor || value.change_id !== id || value.number !== number || !Array.isArray(value.tasks)) return invalid()
  if (value.snapshot === null) return { actor_id: actor, change_id: id, number, snapshot: null, tasks: [] }
  const snapshot = value.snapshot
  if (!object(snapshot) || snapshot.version !== 1 || snapshot.change_id !== id || snapshot.number !== number
    || typeof snapshot.captured_at !== 'string' || !Number.isFinite(Date.parse(snapshot.captured_at)) || !object(snapshot.sheets)
    || !Array.isArray(snapshot.sheets.materials) || !object(snapshot.sheets.questions) || !Array.isArray(snapshot.sheets.questions.questions)
    || !['ecr', 'eco', 'emc', 'execution_plan', 'significant_change'].every(key => object(snapshot.sheets && (snapshot.sheets as Record<string, unknown>)[key]))
    || !(snapshot.source_overview === null || object(snapshot.source_overview))) return invalid()
  const overview = checkedChange(snapshot.overview, { id })
  if (overview.current_review_round !== number || overview.status !== 'pending' || !['ecr', 'eco'].includes(overview.stage ?? '')
    || value.tasks.some(task => !object(task) || task.round !== number || task.can_edit !== false || !Array.isArray(task.confirmed_requests) || task.confirmed_requests.length)) return invalid()
  const data = { ...value, snapshot: { ...snapshot, overview } } as SnapshotData
  checkedStage(snapshotStage(data), id, actor)
  return data
}

function snapshotStage(data: SnapshotData) {
  const snapshot = data.snapshot!
  return { actor_id: data.actor_id, stage: snapshot.overview.stage, change: snapshot.overview, change_id: data.change_id,
    updated_at: snapshot.overview.updated_at, status: 'pending', current_round: data.number, actions: snapshot.actions, tasks: data.tasks,
    unanswered: [], issue_blockers: [], submission_requests: [], submission_request_id: null }
}

export function snapshotClient(data: SnapshotData, user: User): QueryClient {
  const snapshot = data.snapshot!
  // This client belongs only to this actor/round. Historical editors never fetch the live body.
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false, staleTime: Infinity, gcTime: Infinity, retry: false } } })
  client.setQueryData(['me'], user)
  client.setQueryData(['workspace-section'], 'review')
  for (const [resource, sheet] of Object.entries({ materials: 'materials', questions: 'questions', 'ecr-actions': 'ecr', 'eco-actions': 'eco', emc: 'emc', 'execution-plan': 'execution_plan', 'significant-change': 'significant_change' })) {
    client.setQueryData([resource, user.id, data.change_id], snapshot.sheets[sheet])
  }
  client.setQueryData(['stage-workflow', user.id, data.change_id], snapshotStage(data))
  return client
}
