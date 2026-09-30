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
export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  let csrfToken = ''
  if (method !== 'GET') {
    const cookie = document.cookie.split('; ').find((value) => value.startsWith('csrftoken='))
    csrfToken = cookie ? decodeURIComponent(cookie.slice('csrftoken='.length)) : ''
    if (!csrfToken) csrfToken = (await api<{ csrfToken: string }>('/api/auth/csrf/')).csrfToken
  }
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
    if (response.status === 401 || (response.status === 403 && data?.detail && !String(data.detail).includes('CSRF'))) {
      throw new ApiError(response.status, '登录已失效或尚未登录，请重新登录。未保存的填写内容仍保留。')
    }
    const message = data?.detail ?? (data ? Object.values(data).flat().join('；') : '请求验证失败，请重新登录后重试。')
    throw new ApiError(response.status, String(message))
  }
  if (data === null || typeof data !== 'object') {
    throw new ApiError(response.status, '服务器返回格式异常，未能确认操作结果。请保留填写内容后重试。')
  }
  return data as T
}
