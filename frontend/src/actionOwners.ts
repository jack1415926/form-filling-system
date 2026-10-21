import { ApiError, type ActionOwner, type EcrData, type EcoData, type PublishedEcrResult } from './api.ts'

export const actionOwnerLabel = (owner: ActionOwner | null) => owner ? `${owner.display_name}（${owner.username}）${owner.is_active ? '' : ' · 已停用'}` : '尚未关联用户'

export function checkedPublishedResults(value: unknown): PublishedEcrResult[] {
  const rows = value as PublishedEcrResult[] | null
  const positive = (id: unknown) => Number.isSafeInteger(id) && Number(id) > 0
  if (!Array.isArray(rows) || new Set(rows.map(row => row?.id)).size !== rows.length || new Set(rows.map(row => row?.owner?.id)).size !== rows.length
    || !rows.every(row => row && positive(row.id) && positive(row.round) && row.owner && positive(row.owner.id)
      && typeof row.owner.username === 'string' && typeof row.owner.display_name === 'string' && typeof row.owner.is_active === 'boolean'
      && typeof row.result === 'string' && !!row.result.trim() && ['completed', 'not_applicable'].includes(row.status)
      && typeof row.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.date) && Number.isFinite(Date.parse(row.date))
      && typeof row.confirmed_at === 'string' && Number.isFinite(Date.parse(row.confirmed_at))))
    throw new ApiError(200, '来源ECR逐人确认结果不完整，请重新读取。')
  return rows
}

export function checkedActionData(value: unknown, prefix: 'ecr'): EcrData
export function checkedActionData(value: unknown, prefix: 'eco'): EcoData
export function checkedActionData(value: unknown, prefix: 'ecr' | 'eco'): EcrData | EcoData {
  const data = value as EcrData | EcoData | null
  const states = prefix === 'eco' ? ['', 'completed', 'not_applicable', 'implementation_stage'] : ['', 'completed', 'not_applicable']
  if (!data || typeof data.updated_at !== 'string' || !Number.isFinite(Date.parse(data.updated_at)) || !Array.isArray(data.actions)
    || data.actions.length !== 61 || new Set(data.actions.map(row => row?.id)).size !== 61
    || !data.actions.every(row => row && typeof row.id === 'string' && new RegExp(`^${prefix}_\\d{3}$`).test(row.id)
      && Number(row.id.slice(-3)) >= 1 && Number(row.id.slice(-3)) <= 61
      && Number.isInteger(row.number) && row.number >= 1 && row.number <= 27 && typeof row.function === 'string' && typeof row.text === 'string'
      && ['', 'Y', 'N'].includes(row.question_answer) && typeof row.result === 'string' && states.includes(row.status)
      && (row.date === null || typeof row.date === 'string' && Number.isFinite(Date.parse(row.date)))
      && Array.isArray(row.owner_user_ids) && new Set(row.owner_user_ids).size === row.owner_user_ids.length
      && row.owner_user_ids.every(id => Number.isSafeInteger(id) && id > 0)
      && Array.isArray(row.owner_users) && row.owner_users.length === row.owner_user_ids.length
      && row.owner_users.every((owner, index) => owner && owner.id === row.owner_user_ids[index]
        && typeof owner.username === 'string' && typeof owner.display_name === 'string' && typeof owner.is_active === 'boolean'))) {
    throw new ApiError(200, '行动响应不完整，保存结果未确认；填写内容仍保留，请刷新或重试。')
  }
  if (prefix === 'ecr') {
    const ecr = data as EcrData
    if (ecr.source_ecr_id !== undefined && (!Number.isSafeInteger(ecr.source_ecr_id) || ecr.source_ecr_id <= 0)) throw new ApiError(200, '来源ECR编号响应不完整。')
    for (const row of ecr.actions) if (ecr.source_ecr_id !== undefined || row.task_results !== undefined) checkedPublishedResults(row.task_results)
  }
  return data
}
