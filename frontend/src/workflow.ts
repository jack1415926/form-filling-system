import type { QueryClient } from '@tanstack/react-query'
import type { ChangeRequest, User } from './api.ts'

export const canEdit = (record: Pick<ChangeRequest, 'status'> & Partial<Pick<ChangeRequest, 'applicant'>>, actor?: Pick<User, 'id'>) => (!actor || record.applicant === actor.id) && ['draft', 'returned'].includes(record.status)
export const canReview = (user: Pick<User, 'can_review'>) => user.can_review !== false
export const actorUser = (client: QueryClient) => client.getQueryData<User>(['me'])!
export const backLabel = (client: QueryClient) => client.getQueryData(['workspace-section']) === 'review' ? '返回待我处理' : '返回我的申请'
