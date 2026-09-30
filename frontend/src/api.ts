export type User = { id: number; username: string; display_name: string }
export type Overview = {
  title: string; ecr_no: string; eco_no: string; affected_products: string
  affected_region: string; initiating_factory: string; affected_factories: string
  ccb_owner: string; change_owner: string; planned_eco_date: string | null; change_reason: string
}
export type ChangeRequest = Overview & {
  id: number; applicant: number; status: 'draft' | 'pending' | 'approved'; created_at: string; updated_at: string
}
export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}
let csrfToken = ''
export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  if (method !== 'GET' && !csrfToken) csrfToken = (await api<{ csrfToken: string }>('/api/auth/csrf/')).csrfToken
  let response: Response
  try {
    response = await fetch(path, {
      method, credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(method !== 'GET' ? { 'X-CSRFToken': csrfToken } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
  } catch { throw new ApiError(0, '无法连接服务器，请检查连接后重试。填写内容仍保留。') }
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const message = data?.detail ?? (data ? Object.values(data).flat().join('；') : '请求验证失败，请重新登录后重试。')
    throw new ApiError(response.status, String(message))
  }
  if (data?.csrfToken) csrfToken = data.csrfToken
  return data as T
}
