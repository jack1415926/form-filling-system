import { useEffect, useImperativeHandle, useRef, useState, useSyncExternalStore, type Ref } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Drawer, FloatButton, Input, Select, Spin, Table, Tabs, Tag } from 'antd'
import { api, ApiError, type User } from './api'
import { saveResultUnconfirmed } from './questionDraft'
import { checkedFeedback, checkedFeedbackPage, feedbackCategories, feedbackStates, feedbackConfirmed, newerFeedback, requestFeedbackDrawer, hasReviewDrawer, openReviewDrawer, subscribeReviewDrawer,
  type Feedback, type FeedbackCategory, type FeedbackStatus, type FeedbackDetail, type FeedbackOperation } from './systemFeedback'

export type FeedbackHandle = { leave: (action: (discard: () => void) => void) => void; manage: () => void }
type Props = { user: User; leaving: boolean; onReauthenticate: () => void; handleRef: Ref<FeedbackHandle> }
const options = (values: Record<string, string>) => Object.entries(values).map(([value, label]) => ({ value, label }))
const time = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false })

export default function SystemFeedbackPanel({ user, leaving, onReauthenticate, handleRef }: Props) {
  const client = useQueryClient(), { modal, message } = App.useApp()
  const reviewAvailable = useSyncExternalStore(subscribeReviewDrawer, hasReviewDrawer)
  const [open, setOpen] = useState(false), [mode, setMode] = useState<'create' | 'mine' | 'manage'>('create')
  useEffect(() => {
    const open = () => requestFeedbackDrawer('system', () => setOpen(true))
    window.addEventListener('system-feedback-open', open)
    return () => window.removeEventListener('system-feedback-open', open)
  }, [])
  const [category, setCategory] = useState<FeedbackCategory>('problem'), [content, setContent] = useState('')
  const [filterCategory, setFilterCategory] = useState(''), [filterStatus, setFilterStatus] = useState(''), [page, setPage] = useState(1)
  const [selected, setSelected] = useState<number | null>(null)
  const [draft, setDraft] = useState<{ text: string; status: FeedbackStatus; version: number } | null>(null)
  const [busy, setBusy] = useState(false), [unknown, setUnknown] = useState<FeedbackOperation | null>(null), [error, setError] = useState<string | null>(null)
  const flight = useRef(false), active = useRef(true), currentUser = useRef(user)
  useEffect(() => { currentUser.current = user }, [user])
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const managed = mode === 'manage', allowed = !!user.can_manage_feedback
  const revoked = managed && !allowed
  const dirty = !!content || !!draft?.text || !!draft && draft.status !== client.getQueryData<FeedbackDetail>(['system-feedback-detail', user.id, mode, selected])?.status
  const pending = busy || !!unknown
  const blocked = leaving || pending || revoked
  const base = '/api/system-feedback/', detailPath = base + (managed ? 'manage/' : '') + selected + '/'
  const detailKey = ['system-feedback-detail', user.id, mode, selected]
  const validActor = () => active.current && client.getQueryData<User>(['me'])?.id === user.id
  const accept = (data: FeedbackDetail) => {
    if (!validActor() || (managed && !currentUser.current.can_manage_feedback)) return data
    const key = ['system-feedback-detail', user.id, mode, data.id]
    const latest = newerFeedback(client.getQueryData<FeedbackDetail>(key), data)
    client.setQueryData(key, latest)
    void client.invalidateQueries({ queryKey: ['system-feedback-list', user.id] })
    return latest
  }
  const list = useQuery({ queryKey: ['system-feedback-list', user.id, mode, filterCategory, filterStatus, page], enabled: open && mode !== 'create' && !revoked,
    refetchOnWindowFocus: false, queryFn: async () => checkedFeedbackPage(await api<unknown>(`${base}${managed ? 'manage/' : ''}?category=${filterCategory}&status=${filterStatus}&page=${page}`, 'GET', undefined, user.id), managed ? undefined : user.id) })
  const detail = useQuery({ queryKey: detailKey, enabled: open && selected !== null && !revoked, refetchOnWindowFocus: false,
    queryFn: async () => accept(checkedFeedback(await api<unknown>(detailPath, 'GET', undefined, user.id), { id: selected!, owner: managed ? undefined : user.id })) })
  const data = revoked ? undefined : detail.data

  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (dirty || pending) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', unload)
    return () => window.removeEventListener('beforeunload', unload)
  }, [dirty, pending])
  useEffect(() => {
    if (!allowed) {
      client.removeQueries({ predicate: (query) => ['system-feedback-list', 'system-feedback-detail'].includes(String(query.queryKey[0])) && query.queryKey[1] === user.id && query.queryKey[2] === 'manage' })
    }
  }, [allowed, client, user.id])
  const discardDrafts = () => { if (validActor()) { setContent(''); setDraft(null); setUnknown(null) } }
  const confirmLeave = (action: () => void, discard = false, deferDiscard = false) => {
    if (flight.current || (unknown && !revoked)) { message.warning('请先查询结果或按原请求重试。'); return }
    if (!dirty && !unknown) { action(); return }
    modal.confirm({ title: discard ? '放弃未发送的系统反馈？' : '保留输入并切换？',
      content: revoked && unknown ? '管理权限已取消，原操作可能已执行。放弃输入后可以离开，请联系反馈管理员核对结果。' : discard ? '未发送文字会丢失，已经提交的反馈及处理记录保持。' : '当前文字保留在本次登录页面中，返回后可继续填写。',
      okText: discard ? '放弃并离开' : '保留并切换', cancelText: '继续填写', onOk: () => { if (discard && !deferDiscard) discardDrafts(); action() } })
  }
  useEffect(() => {
    const switchDrawer = (event: Event) => {
      const request = event as CustomEvent<{ kind: string; open: () => void }>
      if (open && request.detail.kind === 'review') {
        request.preventDefault()
        confirmLeave(() => { setOpen(false); request.detail.open() })
      }
    }
    window.addEventListener('feedback-drawer-request', switchDrawer)
    return () => window.removeEventListener('feedback-drawer-request', switchDrawer)
  })
  const openDrawer = () => requestFeedbackDrawer('system', () => setOpen(true))
  const settle = (operation: FeedbackOperation, result: FeedbackDetail) => {
    if (!validActor() || (operation.kind === 'action' && !currentUser.current.can_manage_feedback)) return
    if (!feedbackConfirmed(operation, result, user.id)) throw new ApiError(200, '响应未确认原请求，请查询结果。')
    accept(result); setUnknown(null); setError(null)
    if (operation.kind === 'create') { setContent(''); setMode('mine'); setFilterStatus(''); setFilterCategory(''); setPage(1); setSelected(result.id) }
    else setDraft(null)
    message.success(operation.kind === 'create' ? '系统反馈已提交' : '处理记录已保存')
  }
  const perform = async (operation: FeedbackOperation, query = false) => {
    if (flight.current || leaving || !validActor() || (operation.kind === 'action' && !currentUser.current.can_manage_feedback)) return
    flight.current = true; setBusy(true); setError(null)
    const { kind, ...payload } = operation
    let path = kind === 'create' ? base : `${base}manage/${operation.id}/actions/`
    if (query) path = kind === 'create' ? `${base}requests/${operation.request_id}/` : `${base}manage/${operation.id}/requests/${operation.request_id}/`
    try {
      const body = kind === 'create' ? payload : { text: operation.text, status: operation.status, expected_version: operation.expected_version, request_id: operation.request_id }
      const response = checkedFeedback(await api<unknown>(path, query ? 'GET' : 'POST', query ? undefined : body, user.id), { id: kind === 'action' ? operation.id : undefined, owner: kind === 'create' ? user.id : undefined })
      settle(operation, response)
    } catch (failure) {
      if (!validActor()) return
      setError(query && failure instanceof ApiError && failure.status === 404 ? '尚未查到原请求，结果仍未确认；请稍后查询或按原请求重试。' : failure instanceof Error ? failure.message : String(failure))
      if (!query && saveResultUnconfirmed(failure)) setUnknown(operation)
      if (!query && failure instanceof ApiError && [400, 409].includes(failure.status)) setUnknown(null)
      if (!query && failure instanceof ApiError && failure.status === 409 && kind === 'action') void detail.refetch()
      if (!query && failure instanceof ApiError && failure.status === 403 && kind === 'action') void client.invalidateQueries({ queryKey: ['me'] })
    } finally { flight.current = false; if (active.current) setBusy(false) }
  }
  const changeMode = (next: 'create' | 'mine' | 'manage') => {
    if (next === mode) return
    // An administrator draft belongs to its original feedback and version.
    if (draft && next !== 'manage') {
      confirmLeave(() => { setDraft(null); setSelected(null); setMode(next); setFilterStatus(''); setFilterCategory(''); setPage(1) }, true)
    } else { setSelected(null); setMode(next); setFilterStatus(next === 'manage' ? 'pending' : ''); setFilterCategory(''); setPage(1) }
  }
  useImperativeHandle(handleRef, () => ({ leave: (action) => confirmLeave(() => action(discardDrafts), true, true), manage: () => { if (allowed && !pending && !leaving) requestFeedbackDrawer('system', () => { changeMode('manage'); setOpen(true) }) } }))
  const selectRow = (id: number | null) => {
    if (id === selected) return
    if (draft) confirmLeave(() => { setDraft(null); setSelected(id) }, true)
    else setSelected(id)
  }
  const draftStale = !!draft && !!data && draft.version !== data.version
  const updateDraft = (patch: Partial<{ text: string; status: FeedbackStatus }>) => {
    if (data) setDraft((current) => ({ text: current?.text ?? '', status: current?.status ?? data.status, version: current?.version ?? data.version, ...patch }))
  }
  return <>
    <FloatButton aria-label="打开系统反馈" tooltip="系统问题或建议，与审核意见分开" description="系统反馈" style={{ right: 104, bottom: 32 }} onClick={openDrawer} />
    <Drawer title={managed ? '系统反馈 · 反馈管理' : '系统反馈'} open={open} size={760} onClose={() => { if (!flight.current && (!unknown || revoked)) setOpen(false) }}
      closable={!busy && (!unknown || revoked)} maskClosable={!busy && (!unknown || revoked)} keyboard={!busy && (!unknown || revoked)}
      extra={<div className="form-actions">{reviewAvailable && <Button disabled={pending && !revoked} onClick={openReviewDrawer}>审核修改意见</Button>}<Button disabled={busy} onClick={onReauthenticate}>重新登录</Button></div>}>
      <p className="muted">系统使用问题与建议独立记录，不影响申请审核。提交后原文只读，管理员处理过程可在这里查看。</p>
      <Tabs activeKey={mode} onChange={(key) => changeMode(key as typeof mode)} items={[
        { key: 'create', label: '提交反馈', disabled: pending && !revoked }, { key: 'mine', label: '我的反馈', disabled: pending && !revoked },
        ...(allowed || revoked ? [{ key: 'manage', label: '反馈管理', disabled: pending && !revoked }] : []),
      ]} />
      {revoked && <Alert type="warning" title="反馈管理权限已取消" description="管理记录已清除，未发送文字可复制。原未知操作可能已执行，请联系反馈管理员核对。" className="form-alert" />}
      {error && <Alert type="error" title={error} className="form-alert" />}
      {unknown && <Alert type="warning" title="操作结果未确认，原请求和输入已保留" className="form-alert" action={<div className="form-actions">
        <Button disabled={busy || leaving || revoked} onClick={() => void perform(unknown, true)}>查询结果</Button><Button disabled={busy || leaving || revoked} onClick={() => void perform(unknown)}>按原请求重试</Button>
        {revoked && <Button onClick={() => confirmLeave(() => { setSelected(null); setMode('mine') }, true)}>放弃输入并返回我的反馈</Button>}
      </div>} />}
      {mode === 'create' ? <>
        <label htmlFor="system-feedback-category">反馈类型</label><Select id="system-feedback-category" aria-label="反馈类型" value={category} options={options(feedbackCategories)} disabled={blocked} onChange={setCategory} style={{ width: '100%', marginBottom: 16 }} />
        <label htmlFor="system-feedback-content">反馈内容</label><Input.TextArea id="system-feedback-content" aria-label="反馈内容" value={content} maxLength={5000} showCount autoSize={{ minRows: 6, maxRows: 16 }} disabled={blocked} onChange={(event) => setContent(event.target.value)} placeholder="描述遇到的问题、操作步骤或建议。请勿填写密码。" />
        <div className="form-footer"><Button disabled={blocked || !content} onClick={() => setContent('')}>清除未发送文字</Button><Button type="primary" loading={busy} disabled={blocked || !content.trim()} onClick={() => void perform({ kind: 'create', category, content: content.trim(), request_id: crypto.randomUUID() })}>提交系统反馈</Button></div>
      </> : <>
        {!revoked && <div className="form-actions feedback-filters">
          <Select aria-label="筛选反馈类型" value={filterCategory} disabled={pending} options={[{ value: '', label: '全部类型' }, ...options(feedbackCategories)]} onChange={(value) => { setFilterCategory(value); setPage(1) }} />
          <Select aria-label="筛选反馈状态" value={filterStatus} disabled={pending} options={[{ value: '', label: '全部状态' }, ...options(feedbackStates)]} onChange={(value) => { setFilterStatus(value); setPage(1) }} />
          <Button disabled={pending} onClick={() => { void list.refetch(); if (selected) void detail.refetch() }}>刷新反馈</Button>
        </div>}
        {!revoked && selected === null && <>
          {list.error && <Alert type="error" title={list.error.message} action={<Button onClick={() => void list.refetch()}>重试</Button>} />}
          <Table<Feedback> rowKey="id" dataSource={list.data?.results ?? []} loading={list.isFetching} pagination={{ current: page, pageSize: 20, total: list.data?.count ?? 0, showSizeChanger: false, onChange: setPage }} columns={[
            { title: '编号／内容', render: (_, row) => <Button type="link" disabled={pending} onClick={() => selectRow(row.id)}>#{row.id} · {row.content.slice(0, 32)}</Button> },
            ...(managed ? [{ title: '提交者', render: (_: unknown, row: Feedback) => row.submitter.display_name }] : []),
            { title: '类型', render: (_, row) => feedbackCategories[row.category] }, { title: '状态', render: (_, row) => <Tag>{feedbackStates[row.status]}</Tag> },
            { title: '提交时间', dataIndex: 'created_at', render: time },
          ]} />
        </>}
        {selected !== null && !revoked && <>
          <Button disabled={pending} onClick={() => selectRow(null)}>返回反馈列表</Button>
          {detail.error && <Alert type="error" title="读取失败，当前输入仍保留" description={detail.error.message} className="form-alert" />}
          {!data ? <Spin /> : <>
            <h3>反馈 #{data.id} <Tag>{feedbackCategories[data.category]}</Tag><Tag>{feedbackStates[data.status]}</Tag></h3>
            <p className="muted">{data.submitter.display_name} · {time(data.created_at)}</p><p className="question-text">{data.content}</p>
            <h3>处理记录</h3>{data.events.length === 0 && <p className="muted">尚无处理记录。</p>}
            {data.events.map((event) => <section className="review-note" key={event.id}><strong>{event.actor.display_name}</strong><span className="muted"> · {time(event.created_at)}</span><p>{feedbackStates[event.from_status]} → {feedbackStates[event.to_status]}</p><p className="question-text">{event.text || '开始处理'}</p></section>)}
            {managed && <>
              <h3>回复与更新状态</h3><Select aria-label="处理状态" disabled={blocked} value={draft?.status ?? data.status} options={options(feedbackStates).filter((item) => data.status === 'pending' || item.value !== 'pending')} onChange={(status) => updateDraft({ status })} style={{ width: '100%', marginBottom: 12 }} />
              <Input.TextArea aria-label="管理员处理说明" value={draft?.text ?? ''} maxLength={5000} showCount autoSize={{ minRows: 4, maxRows: 12 }} disabled={blocked} onChange={(event) => updateDraft({ text: event.target.value })} placeholder="回复对用户公开；关闭或重新打开须说明处理结果或原因。" />
              {draftStale && <Alert type="warning" title="反馈已被其他操作更新，文字仍保留；核对后清除草稿并重新填写。" className="form-alert" />}
              <div className="form-footer"><Button disabled={blocked || !draft} onClick={() => setDraft(null)}>清除处理草稿</Button><Button type="primary" loading={busy} disabled={blocked || !draft || draftStale || (!draft.text.trim() && !(data.status === 'pending' && draft.status === 'processing'))} onClick={() => { if (draft) void perform({ kind: 'action', id: data.id, text: draft.text.trim(), status: draft.status, expected_version: draft.version, request_id: crypto.randomUUID() }) }}>保存处理记录</Button></div>
            </>}
          </>}
        </>}
        {revoked && draft && <p className="question-text">未发送说明：{draft.text}</p>}
        {revoked && !unknown && <Button onClick={() => confirmLeave(() => { setSelected(null); setMode('mine') }, true)}>返回我的反馈</Button>}
      </>}
    </Drawer>
  </>
}
