import { ApiError } from './api.ts'

export function saveResultUnconfirmed(error: unknown): boolean {
  // Rejections such as 400/403/409 confirm that this request was not applied.
  // Network loss, server/proxy failures, or an unreadable success do not.
  return !(error instanceof ApiError) || error.status === 0 || error.status >= 500 || (error.status >= 200 && error.status < 300)
}
