import { actorUser, canEdit, backLabel } from './workflow'
import DateInput from './DateInput'
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App as AntApp, Button, ConfigProvider, Empty, Form, Input, Spin, Table, Tabs, Tag, Modal } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { api, ApiError, type ChangeRequest, type Overview, type User } from './api'
import './App.css'
import MaterialEditor from './MaterialEditor'
import QuestionEditor from './QuestionEditor'
import EcrPreview from './EcrPreview'
import EmcEditor from './EmcEditor'
import EcrEditor from './EcrEditor'
import EcoEditor from './EcoEditor'
import ExecutionPlanEditor from './ExecutionPlanEditor'
import SignificantChangeEditor from './SignificantChangeEditor'
import SubmissionEditor from './SubmissionEditor'
import ReviewWorkbench from './ReviewWorkbench'
import ReviewPanel from './ReviewPanel'
import { submissionChoiceWarning } from './submission'
import SaveBeforeSwitch, { type SaveHandle } from './SaveBeforeSwitch'
import { newestResponse } from './latestResponse'
import useAutosave, { discardSavedWarning } from './useAutosave'
import { overviewFields } from './autosaveFields'

const stateLabels = { draft: '草稿', pending: '待审核', approved: '已批准', returned: '待修订' }
const stateColors = { draft: 'default', pending: 'gold', approved: 'green', returned: 'orange' }
const reviewReadOnlyTheme = { components: {
  Input: { colorTextDisabled: '#243731', colorBgContainerDisabled: '#f8faf9' },
  Select: { colorTextDisabled: '#243731', colorBgContainerDisabled: '#f8faf9' },
} }
const dateTime = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false })

function Login({ onLogin, compact = false, onBusy }: { onLogin: (user: User) => void; compact?: boolean; onBusy?: (busy: boolean) => void }) {
  const mutation = useMutation({
    mutationFn: (values: { username: string; password: string }) => api<{ user: User }>('/api/auth/login/', 'POST', values),
    onSuccess: (result) => onLogin(result.user),
    onMutate: () => onBusy?.(true),
    onSettled: () => onBusy?.(false),
  })
  const form = <section className="panel login-panel">
      <h2>登录工作台</h2><p className="muted">使用已有账号登录</p>
      {mutation.error && <Alert type="error" showIcon title={mutation.error.message} className="form-alert" />}
      <Form layout="vertical" onFinish={(values) => mutation.mutate(values)} disabled={mutation.isPending} requiredMark={false}>
        <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}><Input autoComplete="username" size="large" placeholder="请输入用户名" /></Form.Item>
        <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}><Input.Password autoComplete="current-password" size="large" placeholder="请输入密码" /></Form.Item>
        <Button type="primary" htmlType="submit" size="large" block loading={mutation.isPending}>登录</Button>
      </Form>
    </section>
  return compact ? form : <div className="login-layout">
    <section className="login-intro">
      <span className="eyebrow">设计变更管理</span>
      <h1>每一项变更，<br />从清晰的记录开始。</h1>
      <p>填写概述，保存草稿。随时重新打开，继续上一次的工作。</p>
      <div className="login-flow"><span>01 填写概述</span><span>02 保存草稿</span><span>03 继续填写</span></div>
    </section>
    {form}
  </div>
}

function OverviewEditor({ record, onDirty, onSaved, onBack, onBusy, leaving, onNext, saveRef, paused = false }: {
  record: ChangeRequest; onDirty: (dirty: boolean) => void; onSaved: (record: ChangeRequest) => void; onBack: () => void; onBusy: (busy: boolean) => void; leaving: boolean; onReauthenticate: () => void; onNext?: () => void
  saveRef?: Ref<SaveHandle>; paused?: boolean
}) {
  const [form] = Form.useForm<Overview>()
  const [dateInvalid, setDateInvalid] = useState(false)
  const queryClient = useQueryClient()
  const actorId = actorUser(queryClient).id
  const locked = !canEdit(record, actorUser(queryClient).role)
  const save = useAutosave({
    fields: overviewFields(record), enabled: !locked && !leaving, valid: !dateInvalid, paused, onDirty, onBusy,
    send: async (patch) => {
      try { await form.validateFields() } catch { throw new ApiError(400, '请修正表单校验提示后保存') }
      const result = await api<ChangeRequest>('/api/changes/' + record.id + '/', 'PATCH', patch, actorId)
      const latest = newestResponse(queryClient.getQueryData<ChangeRequest>(['change', actorId, record.id]), result)
      if (save.queue.active) onSaved(latest)
      return overviewFields(latest)
    },
  })
  const dirty = save.dirty
  const valuesKey = JSON.stringify(save.values)
  useEffect(() => {
    const values = { ...save.values, planned_eco_date: save.values.planned_eco_date ?? '' }
    if (dateInvalid) delete (values as Partial<Overview>).planned_eco_date
    form.setFieldsValue(values)
  }, [valuesKey, form, dateInvalid, save.values])
  useImperativeHandle(saveRef, () => ({ save: save.manualSave }))
  const changed = (_changed: Partial<Overview>, values: Overview) => save.update(overviewFields(values))
  const fields: { key: keyof Overview; label: string; placeholder?: string }[] = [
    { key: 'ecr_no', label: 'ECR 编号', placeholder: '手动填写，例如 ECR-26010601' },
    { key: 'eco_no', label: 'ECO 编号', placeholder: '可稍后补充' },
    { key: 'affected_region', label: '受影响区域' },
    { key: 'initiating_factory', label: '发起变更的工厂（注册人）' },
    { key: 'ccb_owner', label: 'CCB 负责人' },
    { key: 'change_owner', label: '设计负责人／变更发起人' },
  ]
  return <>
    <div className="page-heading"><div><span className="eyebrow">申请 #{record.id}</span><h1>变更概述 <Tag color={stateColors[record.status]}>{stateLabels[record.status]}</Tag></h1><p className="muted">先记录基本信息，草稿可保存尚未填完整的内容。</p></div><Button onClick={onBack} disabled={(save.pending || save.manual) || leaving}>{backLabel(queryClient)}</Button></div>
    <section className="panel overview-panel">
      <div className="section-heading"><div><h2>概述基本信息</h2><p className="muted">申请者由登录账号确定，业务负责人单独填写。</p></div><span className={dirty ? 'save-status unsaved' : 'save-status'}>{save.status}</span></div>
      {locked && <Alert type="info" title="申请已锁定，概述仅供查看。" className="form-alert" />}
      <Form form={form} initialValues={{ ...record, planned_eco_date: record.planned_eco_date ?? '' }} layout="vertical" onValuesChange={changed} onFinish={save.clickSave} disabled={locked || save.manual || leaving} {...save.composition} requiredMark={false}>
        <Form.Item name="title" label="ECR/ECO 标题" rules={[{ max: 255, message: '标题最多 255 个字符' }]}><Input placeholder="填写这项设计变更的标题" maxLength={255} /></Form.Item>
        <Form.Item name="affected_products" label="受影响产品和型号"><Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} placeholder="填写涉及的产品及型号" /></Form.Item>
        <div className="form-grid">{fields.map((field) => <Form.Item key={field.key} name={field.key} label={field.label} rules={[{ max: field.key.endsWith('_no') ? 64 : 255, message: '内容超过允许长度' }]}><Input placeholder={field.placeholder} /></Form.Item>)}</div>
        <div className="form-grid"><Form.Item name="affected_factories" label="受影响工厂"><Input.TextArea autoSize={{ minRows: 2, maxRows: 5 }} /></Form.Item><Form.Item name="planned_eco_date" label="ECO 计划完成时间" getValueFromEvent={(event) => { const invalid = event.target.validity.badInput; setDateInvalid(invalid); const value = invalid ? form.getFieldValue('planned_eco_date') : event.target.value; if (!invalid) save.update({ planned_eco_date: value || null }); return value }} rules={[{ validator: () => dateInvalid ? Promise.reject(new Error('请补全日期或清空全部日期部分')) : Promise.resolve() }]}><DateInput /></Form.Item></div>
        <Form.Item name="change_reason" label="变更原因"><Input.TextArea autoSize={{ minRows: 4, maxRows: 12 }} placeholder="说明变更来源、原因分析和解决措施" /></Form.Item>
        {save.error && <Alert type="error" showIcon title="保存失败，填写内容仍保留" description={save.error.message} className="form-alert" />}
        <div className="form-footer"><span className="muted">最近保存：{dateTime(record.updated_at)}</span><div className="form-actions"><Button type="primary" htmlType="submit" size="large" loading={save.manual} disabled={locked || leaving || save.manual || dateInvalid}>保存草稿</Button><Button htmlType="button" size="large" disabled={save.pending || save.manual || leaving} onClick={onNext}>下一页</Button></div></div>
      </Form>
    </section>
  </>
}

function ChangeEditor(props: Parameters<typeof OverviewEditor>[0] & { onLeaveMessage: (message: string) => void; reviewOnly?: boolean }) {
  const [tab, setTab] = useState('overview')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [issueBusy, setIssueBusy] = useState(false), [issueDirty, setIssueDirty] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const saveRef = useRef<SaveHandle>(null)
  const { modal } = AntApp.useApp()
  const { onLeaveMessage } = props
  useEffect(() => { onLeaveMessage(tab === 'submission' ? submissionChoiceWarning : discardSavedWarning); return () => onLeaveMessage(discardSavedWarning) }, [tab, onLeaveMessage])
  useEffect(() => {
    const handleUnload = (event: BeforeUnloadEvent) => {
      if (dirty || busy || issueDirty || issueBusy) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', handleUnload)
    return () => window.removeEventListener('beforeunload', handleUnload)
  }, [dirty, busy, issueDirty, issueBusy])
  const editorProps = { ...props,
    leaving: props.leaving || issueBusy,
    saveRef,
    paused: confirming,
    onDirty: (value: boolean) => { setDirty(value); props.onDirty(value || issueDirty) },
    onBusy: (value: boolean) => { setBusy(value); props.onBusy(value || issueBusy) },
  }
  const switchTab = (key: string) => {
    if (busy || issueBusy || editorOpen || props.leaving || key === tab) return
    const change = () => { setDirty(false); props.onDirty(issueDirty); setTab(key); window.scrollTo({ top: 0 }) }
    if (!dirty) { change(); return }
    setConfirming(true)
    if (!saveRef.current) {
      modal.confirm({ title: tab === 'submission' ? '离开未提交的审核选择？' : '切换前放弃未保存的修改？', okText: '放弃修改并切换', cancelText: '继续填写', content: tab === 'submission' ? submissionChoiceWarning : discardSavedWarning, onOk: () => { setConfirming(false); change() }, onCancel: () => setConfirming(false) })
      return
    }
    const dialog = modal.confirm({ title: '切换前有未保存的修改', content: discardSavedWarning, keyboard: false, maskClosable: false, footer: () => <SaveBeforeSwitch
      save={async () => { if (!saveRef.current) throw new Error('编辑页面已关闭'); await saveRef.current.save() }}
      switchPage={change} discard={() => { setConfirming(false); change(); dialog.destroy() }} close={() => { setConfirming(false); dialog.destroy() }}
    /> })
  }
  return <>{!props.reviewOnly && !!props.record.current_review_round && <ReviewPanel compact key={`${props.record.id}:${props.record.current_review_round}`} changeId={props.record.id} number={props.record.current_review_round} leaving={props.leaving || busy || confirming} onReauthenticate={props.onReauthenticate} onBusy={(value) => { setIssueBusy(value); props.onBusy(value || busy) }} onDirty={(value) => { setIssueDirty(value); props.onDirty(value || dirty) }} />}
    <Tabs activeKey={tab} onChange={switchTab} items={[{ key: 'overview', label: '概述' }, { key: 'materials', label: '物料明细' }, { key: 'questions', label: '问题评估' }, { key: 'ecr', label: 'ECR 评估' }, { key: 'eco', label: 'ECO 执行' }, { key: 'emc', label: 'EMC 参考' }, { key: 'execution-plan', label: '执行计划' }, { key: 'significant-change', label: '实质性变更评估' }, { key: 'submission', label: '提交审核' }].filter((item) => !props.reviewOnly || item.key !== 'submission').map((item) => ({ ...item, disabled: busy || issueBusy || editorOpen || props.leaving }))} />
    {tab === 'overview' ? <OverviewEditor {...editorProps} onNext={() => switchTab('materials')} /> : tab === 'materials' ? <MaterialEditor {...editorProps} onEditorOpen={setEditorOpen} onNext={() => switchTab('questions')} /> : tab === 'questions' ? <QuestionEditor {...editorProps} onPrevious={() => switchTab('materials')} onNext={() => switchTab('ecr')} /> : tab === 'ecr' ? <EcrEditor {...editorProps} onEditorOpen={setEditorOpen} onPrevious={() => switchTab('questions')} onNext={() => switchTab('eco')} /> : tab === 'eco' ? <EcoEditor {...editorProps} onEditorOpen={setEditorOpen} onPrevious={() => switchTab('ecr')} onNext={() => switchTab('emc')} /> : tab === 'emc' ? <EmcEditor {...editorProps} onEditorOpen={setEditorOpen} onPrevious={() => switchTab('eco')} onNext={() => switchTab('execution-plan')} /> : tab === 'execution-plan' ? <ExecutionPlanEditor {...editorProps} onPrevious={() => switchTab('emc')} onNext={() => switchTab('significant-change')} /> : tab === 'significant-change' ? <SignificantChangeEditor {...editorProps} onEditorOpen={setEditorOpen} onPrevious={() => switchTab('execution-plan')} onNext={props.reviewOnly ? undefined : () => switchTab('submission')} /> : <SubmissionEditor {...editorProps} reviewDraftDirty={issueDirty} onPrevious={() => switchTab('significant-change')} />}
  </>
}

function Workspace() {
  const queryClient = useQueryClient()
  const { message } = AntApp.useApp()
  useEffect(() => {
    const refreshIdentity = () => { message.warning('登录账号已变化，本次操作未执行，正在切换工作台。'); void queryClient.invalidateQueries({ queryKey: ['me'] }) }
    const refreshRole = () => { message.warning('账号角色已变化，正在刷新工作台。'); queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'me' }); void queryClient.invalidateQueries({ queryKey: ['me'] }) }
    window.addEventListener('account-changed', refreshIdentity)
    window.addEventListener('role-changed', refreshRole)
    return () => { window.removeEventListener('account-changed', refreshIdentity); window.removeEventListener('role-changed', refreshRole) }
  }, [queryClient, message])
  const user = useQuery({
    queryKey: ['me'], queryFn: async () => {
      try { return await api<User>('/api/auth/me/') }
      catch (error) { if (error instanceof ApiError && error.status === 401 && !queryClient.getQueryData(['me'])) return null; throw error }
    }, retry: false, refetchOnWindowFocus: false,
  })
  if (user.isPending) return <div className="loading-page"><Spin tip="正在连接工作台…"><div className="loading-space" /></Spin></div>
  if (user.data) return user.data.role === 'reviewer' ? <ReviewerWorkspace key={`${user.data.id}:${user.data.role}`} user={user.data} error={user.error} retry={() => { void user.refetch() }} /> : <UserWorkspace key={`${user.data.id}:${user.data.role}`} user={user.data} sessionError={user.error} sessionFetching={user.isFetching} retrySession={() => { void user.refetch() }} />
  if (user.error) return <div className="connection-error"><Alert type="error" showIcon title="无法连接工作台" description={user.error.message} action={<Button onClick={() => void user.refetch()}>重试</Button>} /></div>
  return <div className="app-shell"><header className="topbar"><div className="brand"><span className="brand-mark">变</span><div><strong>表单填报系统</strong><span>设计变更工作台</span></div></div></header><Login onLogin={(currentUser) => {
    queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'me' })
    queryClient.setQueryData(['me'], currentUser)
  }} /></div>
}

function ReviewerWorkspace({ user, error, retry }: { user: User; error: Error | null; retry: () => void }) {
  const queryClient = useQueryClient()
  const { modal } = AntApp.useApp()
  const [reviewBusy, setReviewBusy] = useState(false), [reviewDirty, setReviewDirty] = useState(false)
  const [reauthenticate, setReauthenticate] = useState(false), [reauthBusy, setReauthBusy] = useState(false)
  useEffect(() => {
    const handleUnload = (event: BeforeUnloadEvent) => {
      if (reviewDirty || reviewBusy) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', handleUnload)
    return () => window.removeEventListener('beforeunload', handleUnload)
  }, [reviewDirty, reviewBusy])
  const exit = useMutation({ mutationFn: () => api('/api/auth/logout/', 'POST', undefined, user.id), onSuccess: () => { queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'me' }); queryClient.setQueryData(['me'], null) } })
  return <div className="app-shell"><header className="topbar"><div className="brand"><strong>表单填报系统 · 审核员</strong></div><div className="user-menu"><span>{user.display_name}</span><Button disabled={exit.isPending} onClick={retry}>刷新身份</Button><Button disabled={reviewBusy} onClick={() => setReauthenticate(true)}>重新登录</Button><Button disabled={reviewBusy} loading={exit.isPending} onClick={() => { if (reviewDirty) modal.confirm({ title: "离开未发送的反馈？", content: "未发送的反馈或退回原因会丢失。", onOk: () => exit.mutate() }); else exit.mutate() }}>退出登录</Button></div></header>
    <main className="workspace">{(error || exit.error) && <Alert type="error" title={(error || exit.error)?.message} className="form-alert" />}
      <ReviewWorkbench onBusy={setReviewBusy} onDirty={setReviewDirty} user={user} leaving={exit.isPending || reauthenticate} onReauthenticate={() => setReauthenticate(true)} renderForm={(record, onBack) => <ConfigProvider theme={reviewReadOnlyTheme}><ChangeEditor key={record.id} reviewOnly record={record} onDirty={() => {}} onBusy={() => {}} onLeaveMessage={() => {}} leaving={exit.isPending || reauthenticate || reviewBusy} onReauthenticate={() => setReauthenticate(true)} onBack={onBack} onSaved={() => {}} /></ConfigProvider>} />
    </main>
    <Modal open={reauthenticate} title="重新登录" footer={null} destroyOnHidden closable={!reauthBusy} onCancel={() => setReauthenticate(false)}><Login compact onBusy={setReauthBusy} onLogin={(current) => { if (current.id !== user.id || current.role !== user.role) queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'me' }); queryClient.setQueryData(['me'], current); setReauthenticate(false); void queryClient.invalidateQueries({ queryKey: ['review-list', current.id] }); void queryClient.invalidateQueries({ queryKey: ['review-round', current.id] }) }} /></Modal>
  </div>
}

function UserWorkspace({ user, sessionError, retrySession, sessionFetching }: { user: User; sessionError: Error | null; retrySession: () => void; sessionFetching: boolean }) {
  const queryClient = useQueryClient()
  const { modal, message } = AntApp.useApp()
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [reauthenticate, setReauthenticate] = useState(false)
  const [reauthBusy, setReauthBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [leaveMessage, setLeaveMessage] = useState(discardSavedWarning)
  const records = useQuery({ queryKey: ['changes', user.id], queryFn: () => api<ChangeRequest[]>('/api/changes/', 'GET', undefined, user.id), enabled: !!user })
  const detail = useQuery({ queryKey: ['change', user.id, selectedId], queryFn: async () => {
    const result = await api<ChangeRequest>('/api/changes/' + selectedId + '/', 'GET', undefined, user.id)
    return newestResponse(queryClient.getQueryData<ChangeRequest>(['change', user.id, selectedId]), result)
  }, enabled: !!user && selectedId !== null, refetchOnWindowFocus: false })
  const create = useMutation({
    mutationFn: () => api<ChangeRequest>('/api/changes/', 'POST', {}, user.id),
    onSuccess: (record) => { queryClient.setQueryData(['change', user.id, record.id], record); setSelectedId(record.id); setDirty(false); void queryClient.invalidateQueries({ queryKey: ['changes', user.id] }) },
  })
  const exit = useMutation({
    mutationFn: () => api('/api/auth/logout/', 'POST', undefined, user.id),
    onSuccess: () => { queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'me' }); queryClient.setQueryData(['me'], null); setSelectedId(null); setDirty(false) },
  })
  const refreshAfterRemoval = (id: number) => {
    queryClient.removeQueries({ queryKey: ['change', user.id, id] })
    queryClient.removeQueries({ queryKey: ['materials', user.id, id] })
    queryClient.removeQueries({ queryKey: ['questions', user.id, id] })
    queryClient.removeQueries({ queryKey: ['ecr-actions', user.id, id] })
    queryClient.removeQueries({ queryKey: ['eco-actions', user.id, id] })
    queryClient.removeQueries({ queryKey: ['emc', user.id, id] })
    queryClient.removeQueries({ queryKey: ['execution-plan', user.id, id] })
    queryClient.removeQueries({ queryKey: ['significant-change', user.id, id] })
    queryClient.removeQueries({ queryKey: ['submission', user.id, id] })
    void queryClient.invalidateQueries({ queryKey: ['changes', user.id] })
  }
  const remove = useMutation({
    mutationFn: (id: number) => api<void>(`/api/changes/${id}/`, 'DELETE', undefined, user.id),
    onSuccess: (_, id) => { refreshAfterRemoval(id); message.success('草稿申请已删除') },
    onError: (error, id) => { if (error instanceof ApiError && error.status === 404) refreshAfterRemoval(id) },
  })
  const listBusy = create.isPending || exit.isPending || remove.isPending || reauthBusy
  const navigate = (action: () => void) => {
    if (!dirty) { action(); return }
    if (saving) return
    setConfirming(true)
    modal.confirm({ title: '离开前放弃未保存的修改？', content: leaveMessage, okText: '放弃修改并离开', cancelText: '继续填写', onOk: () => { setConfirming(false); action() }, onCancel: () => setConfirming(false) })
  }
  return <div className="app-shell">
    <header className="topbar"><div className="brand"><span className="brand-mark">变</span><div><strong>表单填报系统</strong><span>设计变更工作台</span></div></div>{user && <div className="user-menu"><span>{user.display_name}</span><Button disabled={saving || listBusy} onClick={() => setReauthenticate(true)}>重新登录</Button><Button type="text" loading={exit.isPending} disabled={saving || listBusy} onClick={() => navigate(() => exit.mutate())}>退出登录</Button></div>}</header>
    <main className="workspace">
      {sessionError && <Alert type="error" showIcon title="登录信息刷新失败，当前填写内容仍保留" description={sessionError.message} className="form-alert" action={<Button loading={sessionFetching} disabled={saving || exit.isPending} onClick={retrySession}>重试</Button>} />}
      {exit.error && <Alert type="error" title={exit.error.message} className="form-alert" />}
      {selectedId === null ? <>
        <div className="page-heading"><div><span className="eyebrow">工作台</span><h1>我的申请</h1><p className="muted">查看已保存的变更记录，或开始一项新的申请。</p></div><Button type="primary" size="large" loading={create.isPending} disabled={listBusy} onClick={() => create.mutate()}>＋ 新建草稿</Button></div>
        {create.error && <Alert type="error" title={create.error.message} className="form-alert" />}
        {remove.error && <Alert type="error" showIcon title={remove.error instanceof ApiError && remove.error.status === 404 ? '申请已不存在或不可访问，列表已刷新' : '删除失败，申请记录仍保留'} description={remove.error instanceof ApiError && remove.error.status === 404 ? undefined : remove.error.message} className="form-alert" />}
        {records.error ? <Alert type="error" title={records.error.message} action={<Button onClick={() => void records.refetch()}>重试</Button>} /> : <section className="panel list-panel"><div className="section-heading"><h2>申请记录</h2><span className="muted">{records.data?.length ?? 0} 项申请</span></div><Table<ChangeRequest> rowKey="id" loading={records.isPending} dataSource={records.data ?? []} pagination={{ pageSize: 10, hideOnSinglePage: true }} scroll={{ x: 720 }} locale={{ emptyText: <Empty description="还没有申请，点击“新建草稿”开始填写" /> }} columns={[
          { title: '变更标题', dataIndex: 'title', render: (title: string, record) => <Button type="link" className="record-title" disabled={listBusy} onClick={() => setSelectedId(record.id)}>{title || '未命名申请'}</Button> },
          { title: 'ECR / ECO 编号', render: (_, record) => <div className="record-number">{record.ecr_no || '—'}{record.eco_no && <span>{record.eco_no}</span>}</div> },
          { title: '状态', dataIndex: 'status', render: (value: ChangeRequest['status']) => <Tag color={stateColors[value]}>{stateLabels[value]}</Tag> },
          { title: '更新时间', dataIndex: 'updated_at', render: dateTime },
          { title: '操作', render: (_, record) => <div className="form-actions"><Button disabled={listBusy} onClick={() => setSelectedId(record.id)}>{canEdit(record) ? (record.status === 'returned' ? '继续修订' : '继续填写') : '查看申请'}</Button>{record.status === 'draft' && <Button danger loading={remove.isPending && remove.variables === record.id} disabled={listBusy} onClick={() => { remove.reset(); modal.confirm({ title: '删除这条草稿申请？', content: <><p>{record.title || '未命名申请'}</p><p>ECR：{record.ecr_no || '未填写'}；ECO：{record.eco_no || '未填写'}</p><p>申请和所有已保存的关联数据会永久删除，无法恢复。</p></>, okText: '永久删除', cancelText: '取消', okButtonProps: { danger: true }, onOk: async () => { try { await remove.mutateAsync(record.id) } catch { /* Render the deletion error beside the list. */ } } }) }}>删除</Button>}</div> },
        ]} /></section>}
      </> : detail.data ? <>
        {detail.error && <Alert type="error" showIcon title="申请信息刷新失败，当前填写内容仍保留" description={detail.error.message} className="form-alert" action={<Button loading={detail.isFetching} disabled={saving || exit.isPending} onClick={() => void detail.refetch()}>重试</Button>} />}
        <ChangeEditor onLeaveMessage={setLeaveMessage} key={selectedId} record={detail.data} onDirty={setDirty} onBusy={setSaving} leaving={exit.isPending || reauthenticate || confirming} onReauthenticate={() => setReauthenticate(true)} onBack={() => navigate(() => { setDirty(false); setSelectedId(null); void queryClient.invalidateQueries({ queryKey: ['changes', user.id] }) })} onSaved={(record) => { queryClient.setQueryData<ChangeRequest>(['change', user.id, record.id], (current) => newestResponse(current, record)); void queryClient.invalidateQueries({ queryKey: ['changes', user.id] }) }} />
      </> : detail.isPending ? <Spin tip="正在读取草稿…"><div className="loading-space" /></Spin> : <Alert type="error" title={detail.error?.message ?? '无法读取申请。'} action={<><Button loading={detail.isFetching} disabled={exit.isPending} onClick={() => void detail.refetch()}>重试</Button><Button disabled={exit.isPending} onClick={() => { setSelectedId(null); setDirty(false) }}>返回列表</Button></>} />}
      <footer className="workspace-footer"><span className="muted">当前提供八张工作表填写、指定／公开提交及提交后锁定；支持按轮审核、退回修订和逐条审核意见复核。</span></footer>
    </main>
    <Modal open={reauthenticate} title="重新登录" footer={null} destroyOnHidden closable={!reauthBusy} maskClosable={false} keyboard={!reauthBusy} onCancel={() => setReauthenticate(false)}>
      <p className="muted">使用原账号可继续当前填写；切换账号会关闭原申请。</p>
      <Login compact onBusy={setReauthBusy} onLogin={(currentUser) => {
        if (currentUser.id !== user.id || currentUser.role !== user.role) queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'me' })
        queryClient.setQueryData(['me'], currentUser)
        setReauthenticate(false)
        if (currentUser.id === user.id) window.dispatchEvent(new Event('editor-reauthenticated'))
        void queryClient.invalidateQueries({ queryKey: ['change', currentUser.id] })
        void queryClient.invalidateQueries({ queryKey: ['materials', currentUser.id] })
        void queryClient.invalidateQueries({ queryKey: ['questions', currentUser.id] })
        void queryClient.invalidateQueries({ queryKey: ['ecr-actions', currentUser.id] })
        void queryClient.invalidateQueries({ queryKey: ['eco-actions', currentUser.id] })
        void queryClient.invalidateQueries({ queryKey: ['emc', currentUser.id] })
        void queryClient.invalidateQueries({ queryKey: ['execution-plan', currentUser.id] })
        void queryClient.invalidateQueries({ queryKey: ['significant-change', currentUser.id] })
        void queryClient.invalidateQueries({ queryKey: ['submission', currentUser.id] })
        void queryClient.invalidateQueries({ queryKey: ['reviewers', currentUser.id] })
        void queryClient.invalidateQueries({ queryKey: ['review-round', currentUser.id] })
      }} />
    </Modal>
  </div>
}

export default function App() {
  return <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#176b5b', borderRadius: 8, fontFamily: '"Segoe UI", "Microsoft YaHei", sans-serif', controlHeight: 40 } }}><AntApp>{new URLSearchParams(window.location.search).get('preview') === 'ecr' ? <EcrPreview /> : <Workspace />}</AntApp></ConfigProvider>
}
