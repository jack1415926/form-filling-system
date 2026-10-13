import { ApiError } from './api.ts'
import { checkedNavigation, type StageSummary } from './stageNavigationData.ts'

export type EngineeringChange = { id: number; title: string; ecr: StageSummary; eco: StageSummary; can_create_eco: boolean; can_delete_ecr: boolean }
export type EngineeringData = { actor_id: number; items: EngineeringChange[] }
export type ProcessFilter = 'all' | 'ecr' | 'eco'
export const processStates = { draft: '草稿', pending: '审核中', returned: '待修订', approved: '已批准', published: '已发布' }

export function checkedEngineering(value: unknown, actor: number): EngineeringData {
  const data = value as EngineeringData | null
  const invalid = () => { throw new ApiError(200, '工程变更列表响应不完整，请重新读取。') }
  if (!data || data.actor_id !== actor || !Array.isArray(data.items)) return invalid()
  const ids = new Set<number>()
  for (const row of data.items) {
    if (!row || !Number.isSafeInteger(row.id) || row.id < 1 || ids.has(row.id) || typeof row.title !== 'string'
      || typeof row.can_create_eco !== 'boolean' || typeof row.can_delete_ecr !== 'boolean') return invalid()
    ids.add(row.id)
    checkedNavigation({ actor_id: actor, current_change_id: row.id, stages: [row.ecr, row.eco] }, row.id, actor)
    if (row.ecr.id !== row.id || !row.ecr.can_open && !row.eco.can_open
      || row.can_create_eco && (!row.ecr.can_open || row.ecr.status !== 'published' || row.eco.status !== 'not_created')
      || row.can_delete_ecr && (!row.ecr.can_open || row.ecr.status !== 'draft')) return invalid()
  }
  return data
}

export function processMenu(stage: 'ecr' | 'eco', reviewOnly = false) {
  return [
    { key: 'summary', label: '流程总览' },
    { key: 'overview', label: '概述' },
    { key: 'materials', label: '物料与处置' },
    { key: 'questions', label: '问题评估' },
    { key: 'ecr', label: stage === 'eco' ? 'ECR评估 · 来源只读' : 'ECR评估 · 本流程' },
    { key: 'eco', label: stage === 'ecr' ? 'ECO执行 · 本流程不填写' : 'ECO执行 · 本流程' },
    { key: 'emc', label: 'EMC参考' },
    { key: 'execution-plan', label: '设计变更执行计划' },
    { key: 'significant-change', label: '实质性评估 · 主表与子表' },
    ...(!reviewOnly ? [{ key: 'submission', label: `提交${stage.toUpperCase()}审核` }] : []),
    { key: 'history', label: '意见与历史' },
  ]
}
