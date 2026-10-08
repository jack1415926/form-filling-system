import { ApiError, type User } from './api.ts'

export type InboxItem = { change_id: number; round: number; title: string; ecr_no: string; status: 'pending' | 'returned'; count: number; summary: string; open_issues: boolean; message_key: string; is_read: boolean }
export type InboxData = { actor_id: number; role: User['role']; count: number; unread_count: number; items: InboxItem[] }
export type InboxNavigation = { actor_id: number; item: InboxItem; onOpened: () => void }
export const inboxNavigationEvent = 'review-inbox-open-application'
export function checkedInbox(value: unknown, user: Pick<User, 'id' | 'role'>): InboxData {
  const data = value as InboxData | null
  const positive = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0
  if (!data || data.actor_id !== user.id || data.role !== user.role || !Array.isArray(data.items)
    || !data.items.every(item => item && positive(item.change_id) && positive(item.round) && positive(item.count)
      && typeof item.title === 'string' && typeof item.ecr_no === 'string' && typeof item.summary === 'string'
      && ['pending', 'returned'].includes(item.status) && typeof item.open_issues === 'boolean'
      && typeof item.is_read === 'boolean' && typeof item.message_key === 'string' && /^[0-9a-f]{64}$/.test(item.message_key))
    || new Set(data.items.map(item => item.change_id)).size !== data.items.length
    || data.count !== data.items.reduce((total, item) => total + item.count, 0)
    || data.unread_count !== data.items.reduce((total, item) => total + (item.is_read ? 0 : item.count), 0)) {
    throw new ApiError(200, '审核消息响应不完整，请刷新后重试。')
  }
  return data
}
