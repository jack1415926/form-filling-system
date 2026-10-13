import { ApiError, type ChangeRequest } from './api.ts'
import { newestResponse } from './latestResponse.ts'

export type StageSummary = { stage: 'ecr' | 'eco'; id: number | null; status: 'draft' | 'pending' | 'returned' | 'approved' | 'published' | 'not_created' | 'unavailable'; number: string | null; current_round: number | null; confirmed: number | null; total: number | null; approved_at: string | null; published_at: string | null; updated_at: string | null; can_open: boolean }
export type NavigationData = { actor_id: number; current_change_id: number; stages: StageSummary[] }

export function currentStageIndex(record: Pick<ChangeRequest, 'stage' | 'status'>) {
  return (record.stage === 'eco' ? 3 : 0) + (['approved', 'published'].includes(record.status) ? 2 : record.status === 'pending' ? 1 : 0)
}
export function currentProcessIndex(record: Pick<ChangeRequest, 'status'>) {
  return record.status === 'published' ? 3 : record.status === 'approved' ? 2 : record.status === 'pending' ? 1 : 0
}
const integer = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0
const date = (value: unknown) => value === null || typeof value === 'string' && Number.isFinite(Date.parse(value))

export function checkedNavigation(value: unknown, id: number, actor: number): NavigationData {
  const data = value as NavigationData | null
  if (!data || data.actor_id !== actor || data.current_change_id !== id || !Array.isArray(data.stages) || data.stages.length !== 2
    || !data.stages.every((stage, index) => stage && stage.stage === ['ecr', 'eco'][index]
      && ['draft', 'pending', 'returned', 'approved', 'published', 'not_created', 'unavailable'].includes(stage.status)
      && (stage.id === null || integer(stage.id) && stage.id > 0) && (stage.number === null || typeof stage.number === 'string')
      && [stage.current_round, stage.confirmed, stage.total].every(value => value === null || integer(value))
      && (stage.confirmed === null || stage.total !== null && stage.confirmed <= stage.total)
      && [stage.updated_at, stage.approved_at, stage.published_at].every(date) && typeof stage.can_open === 'boolean'
      && (!stage.can_open || stage.id !== null && !['unavailable', 'not_created'].includes(stage.status))
      && (!['unavailable', 'not_created'].includes(stage.status) || stage.id === null && stage.number === null && stage.current_round === null && stage.confirmed === null && stage.total === null && stage.approved_at === null && stage.published_at === null && stage.updated_at === null && !stage.can_open))) {
    throw new ApiError(200, '阶段导航响应不完整，请重新查询。')
  }
  return data
}

export function newestNavigation(current: NavigationData | undefined, incoming: NavigationData): NavigationData {
  if (!current) return incoming
  return { ...incoming, stages: incoming.stages.map((stage, index) => {
    const previous = current.stages[index]
    if (!stage.updated_at || !previous.updated_at || stage.can_open !== previous.can_open) return stage
    return newestResponse(previous as StageSummary & { updated_at: string }, stage as StageSummary & { updated_at: string })
  }) }
}

export function stageSteps(stage: StageSummary) {
  const label = stage.stage.toUpperCase()
  const completed = stage.status === 'published' ? 3 : stage.status === 'approved' ? 2 : stage.status === 'pending' ? 1 : 0
  const active = !['published', 'not_created', 'unavailable'].includes(stage.status)
  return ['填写', '处理', '发布'].map((name, index) => ({
    title: `${label}${name}`,
    status: index < completed ? 'finish' as const : index === completed && active ? 'process' as const : 'wait' as const,
    description: index === completed ? stage.status === 'returned' ? '已退回，待修订' : stage.status === 'unavailable' ? '不可访问' : stage.status === 'not_created' ? '待创建' : stage.status === 'pending' ? `已确认 ${stage.confirmed}/${stage.total}` : stage.status === 'approved' ? '已批准，待发布' : undefined : undefined,
  }))
}
