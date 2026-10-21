export type User = { id: number; username: string; display_name: string; can_review?: boolean; can_manage_feedback?: boolean; can_generate_test_data?: boolean }
export type Overview = {
  title: string; ecr_no: string; eco_no: string; affected_products: string
  affected_region: string; initiating_factory: string; affected_factories: string
  ccb_owner: string; change_owner: string; planned_eco_date: string | null; change_reason: string
}
export type ChangeRequest = Overview & {
  // 本地缓存标记：正文权限收回时保留尚未确认的输入，不代表仍有写入权限。
  body_access?: boolean
  applicant_name?: string
  creation_request_id?: string | null
  stage_approver_ids?: number[]
  stage?: 'legacy' | 'ecr' | 'eco'; publisher_id?: number | null
  source_ecr_id?: number | null; source_ecr_no?: string | null; eco_creation_request_id?: string | null
  published_by_id?: number | null; published_at?: string | null; publication_request_id?: string | null
  id: number; applicant: number; status: 'draft' | 'pending' | 'approved' | 'returned' | 'published'; created_at: string; updated_at: string
  current_review_round: number
  review_mode: '' | 'designated'; submitted_at: string | null
}
export type QuestionAnswer = '' | 'Y' | 'N'
export type Question = {
  number: number; function: string; text: string
  remark_hint: { answer: QuestionAnswer; text: string } | null
  answer: QuestionAnswer; remark: string
}
export type QuestionData = { updated_at: string; questions: Question[] }
export type EcrValues = { result: string; status: '' | 'completed' | 'not_applicable'; date: string | null }
export type ActionOwner = { id: number; username: string; display_name: string; is_active: boolean }
export type PublishedEcrResult = { id: number; round: number; owner: ActionOwner; result: string; status: 'completed' | 'not_applicable'; date: string; confirmed_at: string }
export type EcrAction = EcrValues & { task_results?: PublishedEcrResult[]; extra_required?: boolean; owner_user_ids: number[]; owner_users: ActionOwner[]; id: string; number: number; function: string; text: string; question_answer: QuestionAnswer }
export type EcrData = { source_ecr_id?: number; updated_at: string; actions: EcrAction[] }
export type EcoValues = { result: string; status: '' | 'completed' | 'not_applicable' | 'implementation_stage'; date: string | null }
export type EcoAction = EcoValues & { owner_user_ids: number[]; owner_users: ActionOwner[]; id: string; number: number; function: string; text: string; question_answer: QuestionAnswer }
export type EcoData = { updated_at: string; actions: EcoAction[] }
export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}
export function formatApiErrors(value: unknown, path = ''): string[] {
  const labels: Record<string, string> = { filler_id: 'ECO填写人', expected_filler_id: '原填写人', expected_updated_at: '记录更新时间', eco_no: 'ECO编号', ecr_no: 'ECR编号', title: '标题', questions: '问题评估', owners: '行动负责人', owner_user_ids: '行动负责人', publisher_id: '发布人', stage_approver_ids: '批准人', tasks: '行动任务', issues: '审核意见', date: '业务日期', result: '结果说明', status: '状态', expected_round: '审核轮次', request_id: '操作标识', version: '记录版本' }
  if (Array.isArray(value)) return value.flatMap((item) => formatApiErrors(item, path))
  if (value !== null && typeof value === 'object') return Object.entries(value).flatMap(([key, item]) => formatApiErrors(item, key === 'detail' || key === 'non_field_errors' ? path : [path, labels[key] ?? key].filter(Boolean).join('.')))
  return value == null ? [] : [`${path ? path + '：' : ''}${String(value)}`]
}

let sessionVersion = 0

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
    // 总超时包含CSRF获取和响应正文读取，避免只收到响应头后一直卡住。
    return await Promise.race([request<T>(path, method, body, expectedUserId, controller.signal, sessionVersion), deadline])
  } finally { clearTimeout(timer!) }
}

async function request<T>(path: string, method: string, body: unknown, expectedUserId: number | undefined, signal: AbortSignal, version: number): Promise<T> {
  let csrfToken = ''
  if (method !== 'GET') {
    const cookie = document.cookie.split('; ').find((value) => value.startsWith('csrftoken='))
    csrfToken = cookie ? decodeURIComponent(cookie.slice('csrftoken='.length)) : ''
    if (!csrfToken) csrfToken = (await request<{ csrfToken: string }>('/api/auth/csrf/', 'GET', undefined, expectedUserId, signal, version)).csrfToken
  }
  signal.throwIfAborted()
  let response: Response
  try {
    response = await fetch(path, {
      method, credentials: 'same-origin', signal,
      headers: { 'Content-Type': 'application/json', ...(method !== 'GET' ? { 'X-CSRFToken': csrfToken } : {}), ...(expectedUserId !== undefined ? { 'X-Expected-User': String(expectedUserId) } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
  } catch { throw new ApiError(0, method === 'GET' ? '无法连接服务器，请检查连接后重试。' : '连接中断，操作结果未确认。请保留输入，先核对结果再重试。') }
  signal.throwIfAborted()
  if (method === 'DELETE' && response.status === 204) return undefined as T
  const data = await response.json().catch(() => null)
  signal.throwIfAborted()
  if (!response.ok) {
    const detail = typeof data?.detail === 'string' ? data.detail : ''
    const unauthenticated = response.status === 401 || response.status === 403 && (data?.code === 'not_authenticated' || detail === 'Authentication credentials were not provided.')
    const csrfFailed = response.status === 403 && (data?.code === 'csrf_failed' || /^CSRF\b/i.test(detail))
    // 旧会话的迟到错误不能再次触发新登录会话的失效或权限恢复提示。
    if (version === sessionVersion) {
      if (data?.code === 'account_changed') window.dispatchEvent(new Event('account-changed'))
      if (data?.code === 'feedback_permission_changed') window.dispatchEvent(new CustomEvent('feedback-permission-changed', { detail: { expectedUserId } }))
      if (unauthenticated || csrfFailed) window.dispatchEvent(new CustomEvent('authentication-required', { detail: { expectedUserId } }))
    }
    if ((unauthenticated || csrfFailed) && version !== sessionVersion) throw new ApiError(response.status, '登录状态已更新，原请求未执行，请重试。')
    if (unauthenticated) {
      throw new ApiError(response.status, '登录已失效或尚未登录，请重新登录。未保存的填写内容仍保留。')
    }
    if (csrfFailed) throw new ApiError(response.status, '安全校验失败，请使用原账号重新登录后重试。填写内容仍保留。')
    if (response.status >= 500) throw new ApiError(response.status, method === 'GET'
      ? `服务器暂时不可用（HTTP ${response.status}），请稍后重试。`
      : `服务器异常（HTTP ${response.status}），操作结果未确认。请保留输入，先核对结果再重试。`)
    const messages: Record<number, string> = { 400: '请求内容有误，请检查填写内容。', 403: '当前账号没有此操作权限。', 404: '记录不存在或当前账号无权访问。', 409: '数据或流程状态已变化，请核对最新状态后重试。', 429: '操作过于频繁，请稍后重试。' }
    const message = data ? formatApiErrors(data.detail ?? data).join('；') : ''
    throw new ApiError(response.status, message || messages[response.status] || `请求失败（HTTP ${response.status}），请核对后重试。`)
  }
  if (data === null || typeof data !== 'object') {
    throw new ApiError(response.status, '服务器返回格式异常，未能确认操作结果。请保留填写内容后重试。')
  }
  if (method === 'POST' && (path === '/api/auth/login/' || path === '/api/auth/logout/')) sessionVersion++
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
