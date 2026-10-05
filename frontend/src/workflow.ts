import type { QueryClient } from '@tanstack/react-query'
import type { ChangeRequest, User } from './api.ts'

export const canEdit = (record: Pick<ChangeRequest, 'status'>, role: User['role'] = 'filler') => role === 'filler' && ['draft', 'returned'].includes(record.status)
export const actorUser = (client: QueryClient) => client.getQueryData<User>(['me'])!
export const backLabel = (client: QueryClient) => actorUser(client).role === 'reviewer' ? '返回审核列表' : '返回我的申请'
