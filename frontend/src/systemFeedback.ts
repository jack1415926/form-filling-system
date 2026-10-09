import { ApiError } from './api.ts'

export const feedbackCategories = { problem: '问题', suggestion: '建议', other: '其他' }
export const feedbackStates = { pending: '待处理', processing: '处理中', closed: '已关闭' }
export type FeedbackCategory = keyof typeof feedbackCategories
export type FeedbackStatus = keyof typeof feedbackStates
type Person = { id: number; display_name: string }
export type FeedbackEvent = { id: number; actor: Person; text: string; kind?: 'manager' | 'followup'; from_status: FeedbackStatus; to_status: FeedbackStatus; request_id: string; base_version: number; created_at: string }
export type Feedback = { id: number; submitter: Person; category: FeedbackCategory; content: string; status: FeedbackStatus; request_id: string; version: number; created_at: string; updated_at: string }
export type FeedbackDetail = Feedback & { events: FeedbackEvent[] }
export type FeedbackPage = { count: number; next: string | null; previous: string | null; results: Feedback[] }
export type FeedbackOperation = { kind: 'create'; category: FeedbackCategory; content: string; request_id: string } | { kind: 'action' | 'followup'; id: number; text: string; status: FeedbackStatus; expected_version: number; request_id: string }
export type FeedbackInboxItem = { id: number; message_version: number; content: string; status: FeedbackStatus; managed: boolean; read_version: number | null }
export type FeedbackInboxData = { unread_count: number; items: FeedbackInboxItem[] }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const positive = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0
const version = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0
const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value))
const uuid = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const person = (value: unknown) => object(value) && positive(value.id) && typeof value.display_name === 'string'
const state = (value: unknown) => typeof value === 'string' && Object.hasOwn(feedbackStates, value)
function validFeedback(value: unknown): boolean {
  return object(value) && positive(value.id) && person(value.submitter) && typeof value.category === 'string' && Object.hasOwn(feedbackCategories, value.category)
    && typeof value.content === 'string' && !!value.content.trim() && state(value.status) && uuid(value.request_id)
    && version(value.version) && date(value.created_at) && date(value.updated_at)
}
export function checkedFeedback(value: unknown, expected: { id?: number; owner?: number } = {}): FeedbackDetail {
  if (!validFeedback(value) || !object(value) || (expected.id !== undefined && value.id !== expected.id)
    || (expected.owner !== undefined && (value.submitter as Person).id !== expected.owner)
    || !Array.isArray(value.events) || value.events.length !== value.version
    || !value.events.every((event, index) => object(event) && positive(event.id) && person(event.actor) && typeof event.text === 'string'
      && state(event.from_status) && state(event.to_status) && uuid(event.request_id) && event.base_version === index && date(event.created_at)
      && (event.kind === undefined || ['manager', 'followup'].includes(String(event.kind)))
      && (index === 0 ? event.from_status === 'pending' : event.from_status === (value.events as FeedbackEvent[])[index - 1].to_status))
    || (value.events.length ? value.events[value.events.length - 1].to_status !== value.status : value.status !== 'pending')) {
    throw new ApiError(200, '反馈响应不完整，操作结果未确认，请查询原请求。')
  }
  return value as FeedbackDetail
}
export function checkedFeedbackPage(value: unknown, owner?: number): FeedbackPage {
  if (!object(value) || !version(value.count) || !Array.isArray(value.results) || !value.results.every((row) => validFeedback(row) && (owner === undefined || (row.submitter as Person).id === owner))
    || !['next', 'previous'].every((key) => value[key] === null || typeof value[key] === 'string')) throw new ApiError(200, '反馈列表响应不完整，请重试。')
  return value as FeedbackPage
}
export function feedbackConfirmed(operation: FeedbackOperation, data: FeedbackDetail, actorId: number): boolean {
  return operation.kind === 'create'
    ? data.submitter.id === actorId && data.request_id === operation.request_id && data.category === operation.category && data.content === operation.content
    : data.id === operation.id && data.events.some((event) => event.request_id === operation.request_id && event.actor.id === actorId
      && event.text === operation.text && (operation.kind === 'followup' ? event.kind === 'followup' : (event.kind ?? 'manager') === 'manager' && event.to_status === operation.status) && event.base_version === operation.expected_version)
}
export function checkedFeedbackInbox(value: unknown): FeedbackInboxData {
  if (!object(value) || !version(value.unread_count) || !Array.isArray(value.items) || value.items.length !== value.unread_count
    || !value.items.every(item => object(item) && positive(item.id) && version(item.message_version) && typeof item.content === 'string' && state(item.status) && typeof item.managed === 'boolean'
      && (item.read_version === null || version(item.read_version) && Number(item.read_version) < Number(item.message_version)))
    || new Set(value.items.map(item => item.id)).size !== value.items.length) throw new ApiError(200, '反馈提醒响应不完整，请刷新重试。')
  return value as FeedbackInboxData
}
export function unreadFeedbackEvent(event: FeedbackEvent, data: FeedbackDetail, item: FeedbackInboxItem | undefined, userId: number): boolean {
  if (!item || item.id !== data.id || event.actor.id === userId) return false
  const incoming = data.submitter.id === userId ? (event.kind ?? 'manager') === 'manager' : event.kind === 'followup'
  return incoming && event.base_version + 1 > (item.read_version ?? -1)
}
export function feedbackMessageVersion(data: FeedbackDetail, userId: number): number | null {
  const own = data.submitter.id === userId
  const event = [...data.events].reverse().find(event => event.actor.id !== userId && (own ? (event.kind ?? 'manager') === 'manager' : event.kind === 'followup'))
  return event ? event.base_version + 1 : own ? null : 0
}
export function newerFeedback(current: FeedbackDetail | undefined, incoming: FeedbackDetail) {
  return current?.id === incoming.id && current.version > incoming.version ? current : incoming
}
export function requestFeedbackDrawer(kind: 'system' | 'review' | 'inbox', open: () => void) {
  const event = new CustomEvent('feedback-drawer-request', { cancelable: true, detail: { kind, open } })
  if (window.dispatchEvent(event)) open()
}

let reviewDrawerOpener: (() => void) | undefined
let reviewDrawerCount = 0
export const hasReviewDrawer = () => !!reviewDrawerOpener
export const getReviewDrawerCount = () => reviewDrawerCount
export const openReviewDrawer = () => reviewDrawerOpener?.()
export function subscribeReviewDrawer(listener: () => void) {
  window.addEventListener('review-drawer-availability', listener)
  return () => window.removeEventListener('review-drawer-availability', listener)
}
export function registerReviewDrawer(opener: () => void, count = 0) {
  reviewDrawerOpener = opener
  reviewDrawerCount = count
  window.dispatchEvent(new Event('review-drawer-availability'))
  return () => {
    if (reviewDrawerOpener === opener) { reviewDrawerOpener = undefined; reviewDrawerCount = 0; window.dispatchEvent(new Event('review-drawer-availability')) }
  }
}
