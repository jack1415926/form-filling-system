export type User = { id: number; username: string; display_name: string }
export type Overview = {
  title: string; ecr_no: string; eco_no: string; affected_products: string
  affected_region: string; initiating_factory: string; affected_factories: string
  ccb_owner: string; change_owner: string; planned_eco_date: string | null; change_reason: string
}
export type ChangeRequest = Overview & {
  id: number; applicant: number; status: 'draft' | 'pending' | 'approved'; created_at: string; updated_at: string
}
export type QuestionAnswer = '' | 'Y' | 'N'
export type Question = {
  number: number; function: string; text: string
  remark_hint: { answer: QuestionAnswer; text: string } | null
  answer: QuestionAnswer; remark: string
}
export type QuestionData = { updated_at: string; questions: Question[] }
export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}
export function formatApiErrors(value: unknown, path = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => formatApiErrors(item, path))
  if (value !== null && typeof value === 'object') return Object.entries(value).flatMap(([key, item]) => formatApiErrors(item, key === 'detail' || key === 'non_field_errors' ? path : [path, key].filter(Boolean).join('.')))
  return value == null ? [] : [`${path ? path + '：' : ''}${String(value)}`]
}

export async function api<T>(path: string, method = 'GET', body?: unknown, expectedUserId?: number): Promise<T> {
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
      headers: { 'Content-Type': 'application/json', ...(method !== 'GET' ? { 'X-CSRFToken': csrfToken } : {}), ...(expectedUserId !== undefined ? { 'X-Expected-User': String(expectedUserId) } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
  } catch { throw new ApiError(0, '无法连接服务器，请检查连接后重试。填写内容仍保留。') }
  if (method === 'DELETE' && response.status === 204) return undefined as T
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    if (data?.code === 'account_changed') window.dispatchEvent(new Event('account-changed'))
    if (response.status === 401 || (response.status === 403 && data?.detail && !String(data.detail).includes('CSRF'))) {
      throw new ApiError(response.status, '登录已失效或尚未登录，请重新登录。未保存的填写内容仍保留。')
    }
    const message = data ? formatApiErrors(data.detail ?? data).join('；') : '请求验证失败，请重新登录后重试。'
    throw new ApiError(response.status, String(message))
  }
  if (data === null || typeof data !== 'object') {
    throw new ApiError(response.status, '服务器返回格式异常，未能确认操作结果。请保留填写内容后重试。')
  }
  return data as T
}

export type MaterialCategory = 'revision' | 'addition' | 'discontinuation'
export type Dispositions = Record<string, { disposition?: string; remark?: string }>
export type MaterialValues = {
  material_no: string; description: string; material_class: string
  spare_part: '' | 'Y' | 'N'; optional_part: '' | 'Y' | 'N'
  old_revision: string; new_revision: string; revision: string
  detailed_class: string; discontinued_project: string; change_description: string
  dispositions: Dispositions
}
export type Material = MaterialValues & { id: number; category: MaterialCategory }
