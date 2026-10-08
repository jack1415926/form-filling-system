export type User = { id: number; username: string; display_name: string; role: 'filler' | 'reviewer'; can_manage_feedback?: boolean }
export type Overview = {
  title: string; ecr_no: string; eco_no: string; affected_products: string
  affected_region: string; initiating_factory: string; affected_factories: string
  ccb_owner: string; change_owner: string; planned_eco_date: string | null; change_reason: string
}
export type ChangeRequest = Overview & {
  id: number; applicant: number; status: 'draft' | 'pending' | 'approved' | 'returned'; created_at: string; updated_at: string
  current_review_round: number
  review_mode: '' | 'designated' | 'public'; submitted_at: string | null
}
export type QuestionAnswer = '' | 'Y' | 'N'
export type Question = {
  number: number; function: string; text: string
  remark_hint: { answer: QuestionAnswer; text: string } | null
  answer: QuestionAnswer; remark: string
}
export type QuestionData = { updated_at: string; questions: Question[] }
export type EcrValues = { owner: string; result: string; status: '' | 'completed' | 'not_applicable'; date: string | null }
export type EcrAction = EcrValues & { id: string; number: number; function: string; text: string; question_answer: QuestionAnswer }
export type EcrData = { updated_at: string; actions: EcrAction[] }
export type EcoValues = { owner: string; result: string; status: '' | 'completed' | 'not_applicable' | 'implementation_stage'; date: string | null }
export type EcoAction = EcoValues & { id: string; number: number; function: string; text: string; question_answer: QuestionAnswer }
export type EcoData = { updated_at: string; actions: EcoAction[] }
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
  const controller = new AbortController()
  const timeoutError = new ApiError(0, method === 'GET'
    ? '读取超时，请检查连接后重试。'
    : '请求超时，保存结果未确认。请保留填写内容后重试。')
  let timer: ReturnType<typeof setTimeout>
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { reject(timeoutError); controller.abort() }, 30_000)
  })
  try {
    // The deadline also covers CSRF acquisition and a stalled response body.
    return await Promise.race([request<T>(path, method, body, expectedUserId, controller.signal), deadline])
  } finally { clearTimeout(timer!) }
}

async function request<T>(path: string, method: string, body: unknown, expectedUserId: number | undefined, signal: AbortSignal): Promise<T> {
  let csrfToken = ''
  if (method !== 'GET') {
    const cookie = document.cookie.split('; ').find((value) => value.startsWith('csrftoken='))
    csrfToken = cookie ? decodeURIComponent(cookie.slice('csrftoken='.length)) : ''
    if (!csrfToken) csrfToken = (await request<{ csrfToken: string }>('/api/auth/csrf/', 'GET', undefined, undefined, signal)).csrfToken
  }
  signal.throwIfAborted()
  let response: Response
  try {
    response = await fetch(path, {
      method, credentials: 'same-origin', signal,
      headers: { 'Content-Type': 'application/json', ...(method !== 'GET' ? { 'X-CSRFToken': csrfToken } : {}), ...(expectedUserId !== undefined ? { 'X-Expected-User': String(expectedUserId) } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
  } catch { throw new ApiError(0, '无法连接服务器，请检查连接后重试。填写内容仍保留。') }
  signal.throwIfAborted()
  if (method === 'DELETE' && response.status === 204) return undefined as T
  const data = await response.json().catch(() => null)
  signal.throwIfAborted()
  if (!response.ok) {
    if (data?.code === 'account_changed') window.dispatchEvent(new Event('account-changed'))
    if (data?.code === 'role_forbidden') window.dispatchEvent(new Event('role-changed'))
    if (data?.code === 'feedback_permission_changed') window.dispatchEvent(new CustomEvent('feedback-permission-changed', { detail: { expectedUserId } }))
    if (response.status === 401 || (response.status === 403 && !['role_forbidden', 'feedback_permission_changed'].includes(data?.code) && data?.detail && !String(data.detail).includes('CSRF'))) {
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
export type MaterialField = Exclude<keyof MaterialValues, 'dispositions'>
export type Material = MaterialValues & { id: number; category: MaterialCategory }
