import { ApiError, type ActionOwner, type EcrData, type EcoData } from './api.ts'

export const actionOwnerLabel = (owner: ActionOwner | null) => owner ? `${owner.display_name}（${owner.username}）${owner.is_active ? '' : ' · 已停用'}` : '尚未关联用户'

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
      && ['', 'Y', 'N'].includes(row.question_answer) && typeof row.owner === 'string' && typeof row.result === 'string' && states.includes(row.status)
      && (row.date === null || typeof row.date === 'string' && Number.isFinite(Date.parse(row.date)))
      && (row.owner_user_id === null ? row.owner_user === null : Number.isSafeInteger(row.owner_user_id) && row.owner_user_id > 0
        && row.owner_user && row.owner_user.id === row.owner_user_id && typeof row.owner_user.username === 'string'
        && typeof row.owner_user.display_name === 'string' && typeof row.owner_user.is_active === 'boolean'))) {
    throw new ApiError(200, '行动响应不完整，保存结果未确认；填写内容仍保留，请刷新或重试。')
  }
  return data
}
