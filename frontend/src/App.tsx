import { actorUser, canEdit, canReview, backLabel } from './workflow'
import DateInput from './DateInput'
import { useEffect, useImperativeHandle, useRef, useState, type Ref, type RefObject } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App as AntApp, Button, ConfigProvider, Form, Input, Spin, Tag, Modal, Menu, Descriptions, Space } from 'antd'
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
import PublicationPanel from './PublicationPanel'
import EcoFillerPanel from './EcoFillerPanel'
import StageNavigation, { SourceOverview } from './StageNavigation'
import EngineeringChanges from './EngineeringChanges'
import InactiveEcoSheet from './InactiveEcoSheet'
import { processMenu, processStates, type ProcessFilter } from './engineeringChangeData'
import { submissionChoiceWarning } from './submission'
import SaveBeforeSwitch, { type SaveHandle } from './SaveBeforeSwitch'
import { newestResponse } from './latestResponse'
import useAutosave, { discardSavedWarning } from './useAutosave'
import { overviewFields } from './autosaveFields'
import SystemFeedbackPanel, { type FeedbackHandle } from './SystemFeedbackPanel'
import { inboxNavigationEvent, type InboxNavigation } from './reviewInboxData'
import { openReviewDrawer } from './systemFeedback'

const stateLabels = { draft: '草稿', pending: '待审核', approved: '已批准', returned: '待修订', published: '已发布' }
const stateColors = { draft: 'default', pending: 'gold', approved: 'green', returned: 'orange', published: 'blue' }
const reviewReadOnlyTheme = { components: {
  Input: { colorTextDisabled: '#243731', colorBgContainerDisabled: '#f8faf9' },
  Select: { colorTextDisabled: '#243731', colorBgContainerDisabled: '#f8faf9' },
} }
const dateTime = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false })

function Login({ onLogin, compact = false, onBusy }: { onLogin: (user: User) => void; compact?: boolean; onBusy?: (busy: boolean) => void }) {
  const [loginForm] = Form.useForm<{ username: string; password: string }>()
  const [passwordVisible, setPasswordVisible] = useState(false)
  const clearPassword = () => { loginForm.resetFields(['password']); setPasswordVisible(false) }
  const mutation = useMutation({
    // Read credentials only for this request; mutation variables outlive the login form.
    mutationFn: () => api<{ user: User }>('/api/auth/login/', 'POST', loginForm.getFieldsValue()),
    onSuccess: (result) => { clearPassword(); onLogin(result.user) },
    onError: clearPassword,
    onMutate: () => onBusy?.(true),
    onSettled: () => onBusy?.(false),
  })
  const form = <section className="panel login-panel">
      <h2>登录工作台</h2><p className="muted">使用已有账号登录</p>
      {mutation.error && <Alert type="error" showIcon title={mutation.error.message} className="form-alert" />}
      <Form form={loginForm} layout="vertical" onFinish={() => mutation.mutate()} disabled={mutation.isPending} requiredMark={false}>
        <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}><Input autoComplete="username" size="large" placeholder="请输入用户名" /></Form.Item>
        <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}><Input.Password autoComplete="current-password" visibilityToggle={{ visible: passwordVisible, onVisibleChange: setPasswordVisible }} size="large" placeholder="请输入密码" /></Form.Item>
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

export function OverviewEditor({ record, onDirty, onSaved, onBusy, leaving, onNext, saveRef, paused = false }: {
  record: ChangeRequest; onDirty: (dirty: boolean) => void; onSaved: (record: ChangeRequest) => void; onBack: () => void; onBusy: (busy: boolean) => void; leaving: boolean; onReauthenticate: () => void; onNext?: () => void
  saveRef?: Ref<SaveHandle>; paused?: boolean
}) {
  const [form] = Form.useForm<Overview>()
  const [dateInvalid, setDateInvalid] = useState(false)
  const queryClient = useQueryClient()
  const actorId = actorUser(queryClient).id
  const locked = !canEdit(record, actorUser(queryClient))
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
    <div className="page-heading"><div><span className="eyebrow">申请 #{record.id}</span><h1>变更概述 <Tag color={stateColors[record.status]}>{['ecr', 'eco'].includes(record.stage ?? '') && record.status === 'pending' ? '处理中' : stateLabels[record.status]}</Tag></h1><p className="muted">先记录基本信息，草稿可保存尚未填完整的内容。</p></div></div>
    <section className="panel overview-panel">
      <div className="section-heading"><div><h2>概述基本信息</h2><p className="muted">{record.stage === 'eco' ? 'ECO填写人由创建或交接时指定，业务负责人单独填写。' : '申请者由登录账号确定，业务负责人单独填写。'}</p></div><span className={dirty ? 'save-status unsaved' : 'save-status'}>{save.status}</span></div>
      {locked && <Alert type="info" title={['draft', 'returned'].includes(record.status) ? '当前由指定填写人编辑，概述仅供查看。' : '申请已锁定，概述仅供查看。'} className="form-alert" />}
      <Form form={form} initialValues={{ ...record, planned_eco_date: record.planned_eco_date ?? '' }} layout="vertical" onValuesChange={changed} onFinish={save.clickSave} disabled={locked || save.manual || leaving} {...save.composition} requiredMark={false}>
        <Form.Item name="title" label="ECR/ECO 标题" rules={[{ max: 255, message: '标题最多 255 个字符' }]}><Input placeholder="填写这项设计变更的标题" maxLength={255} /></Form.Item>
        <Form.Item name="affected_products" label="受影响产品和型号"><Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} placeholder="填写涉及的产品及型号" /></Form.Item>
        <div className="form-grid">{fields.map((field) => record.stage === 'eco' && field.key === 'ecr_no'
          ? <Form.Item key={field.key} label="来源ECR编号"><Input aria-label="来源ECR编号" value={record.source_ecr_no ?? ''} readOnly disabled /></Form.Item>
          : <Form.Item key={field.key} name={field.key} label={field.label} rules={[{ max: field.key.endsWith('_no') ? 64 : 255, message: '内容超过允许长度' }]}><Input placeholder={record.stage === 'ecr' && field.key === 'eco_no' ? 'ECO尚未启动' : field.placeholder} disabled={locked || save.manual || leaving || record.stage === 'ecr' && field.key === 'eco_no'} /></Form.Item>)}</div>
        <div className="form-grid"><Form.Item name="affected_factories" label="受影响工厂"><Input.TextArea autoSize={{ minRows: 2, maxRows: 5 }} /></Form.Item><Form.Item name="planned_eco_date" label="ECO 计划完成时间" getValueFromEvent={(event) => { const invalid = !event.target.validity.valid; setDateInvalid(invalid); const value = invalid ? form.getFieldValue('planned_eco_date') : event.target.value; if (!invalid) save.update({ planned_eco_date: value || null }); return value }} rules={[{ validator: () => dateInvalid ? Promise.reject(new Error('请修正日期或清空日期后保存')) : Promise.resolve() }]}><DateInput /></Form.Item></div>
        <Form.Item name="change_reason" label="变更原因"><Input.TextArea autoSize={{ minRows: 4, maxRows: 12 }} placeholder="说明变更来源、原因分析和解决措施" /></Form.Item>
        {save.error && <Alert type="error" showIcon title="保存失败，填写内容仍保留" description={save.error.message} className="form-alert" />}
        <div className="form-footer"><span className="muted">最近保存：{dateTime(record.updated_at)}</span><div className="form-actions"><Button type="primary" htmlType="submit" size="large" loading={save.manual} disabled={locked || leaving || save.manual || dateInvalid}>保存草稿</Button><Button htmlType="button" size="large" disabled={save.pending || save.manual || leaving} onClick={onNext}>下一页</Button></div></div>
      </Form>
    </section>
  </>
}

function ChangeEditor(props: Parameters<typeof OverviewEditor>[0] & { onLeaveMessage: (message: string) => void; reviewOnly?: boolean; initialReviewOpen?: boolean; onOpenChange?: (id: number) => void }) {
  const [tab, setTab] = useState(props.initialReviewOpen ? 'history' : 'summary')
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [editorOpen, setEditorOpen] = useState(false)
  const [issueBusy, setIssueBusy] = useState(false), [issueDirty, setIssueDirty] = useState(false)
  const [confirming, setConfirming] = useState(false), [fillerBusy, setFillerBusy] = useState(false), [publicationBusy, setPublicationBusy] = useState(false)
  const saveRef = useRef<SaveHandle>(null), { modal } = AntApp.useApp(), client = useQueryClient()
  const record = props.record, stage = record.stage === 'eco' ? 'eco' : 'ecr', label = stage.toUpperCase()
  const blocked = busy || issueBusy || publicationBusy || fillerBusy || editorOpen || props.leaving || confirming
  const { onLeaveMessage } = props
  useEffect(() => { onLeaveMessage(tab === 'submission' ? submissionChoiceWarning : discardSavedWarning); return () => onLeaveMessage(discardSavedWarning) }, [tab, onLeaveMessage])
  useEffect(() => {
    const handleUnload = (event: BeforeUnloadEvent) => {
      if (dirty || busy || issueDirty || issueBusy || publicationBusy || fillerBusy) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', handleUnload)
    return () => window.removeEventListener('beforeunload', handleUnload)
  }, [dirty, busy, issueDirty, issueBusy, publicationBusy, fillerBusy])
  const editorProps = { ...props, leaving: props.leaving || issueBusy || publicationBusy || fillerBusy, saveRef, paused: confirming,
    onDirty: (value: boolean) => { setDirty(value); props.onDirty(value || issueDirty) },
    onBusy: (value: boolean) => { setBusy(value); props.onBusy(value || issueBusy || publicationBusy || fillerBusy) },
  }
  const switchTab = (key: string) => {
    if (blocked || key === tab) return
    const change = () => { setDirty(false); props.onDirty(issueDirty); setTab(key) }
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
  const next: Record<string, string> = { overview: 'materials', materials: 'questions', questions: 'summary', ecr: 'summary', eco: 'summary', emc: 'execution-plan', 'execution-plan': 'significant-change', 'significant-change': 'summary' }
  const previous: Record<string, string> = { materials: 'overview', questions: 'materials', ecr: 'summary', eco: 'summary', emc: 'summary', 'execution-plan': 'emc', 'significant-change': 'execution-plan' }
  const navigation = { onPrevious: () => switchTab(previous[tab] ?? 'summary'), onNext: () => switchTab(next[tab] ?? 'summary') }
  const items = processMenu(stage, props.reviewOnly).map(item => ({ ...item, disabled: blocked }))
  const content = tab === 'summary' ? <>
      <StageNavigation record={record} leaving={blocked || dirty || issueDirty} onOpenChange={props.onOpenChange} />
      <section className="panel process-summary"><h2>{label}流程总览</h2><Descriptions column={2} items={[
        { key: 'owner', label: stage === 'eco' ? '当前填写人' : '发起人', children: record.applicant_name || `账号 #${record.applicant}` },
        { key: 'round', label: '本流程审核轮次', children: record.current_review_round || '尚未提交' },
      ]} /><Space wrap><Button disabled={blocked} onClick={() => switchTab('overview')}>查看基础资料</Button><Button type="primary" disabled={blocked} onClick={() => switchTab(stage)}>进入{label}行动</Button>{!props.reviewOnly && <Button disabled={blocked} onClick={() => switchTab('submission')}>提交与准入检查</Button>}<Button disabled={blocked} onClick={() => switchTab('history')}>意见与历史</Button></Space></section>
      <PublicationPanel record={record} leaving={props.leaving || busy || issueBusy || fillerBusy || dirty || issueDirty || editorOpen} onBusy={value => { setPublicationBusy(value); props.onBusy(value || busy || issueBusy || fillerBusy) }} onReauthenticate={props.onReauthenticate} onOpenChange={props.onOpenChange} />
      {stage === 'eco' && <EcoFillerPanel record={record} leaving={props.leaving || busy || issueBusy || publicationBusy || dirty || issueDirty || editorOpen} onBusy={value => { setFillerBusy(value); props.onBusy(value || busy || issueBusy || publicationBusy) }} onReauthenticate={props.onReauthenticate} />}
    </> : tab === 'overview' ? <OverviewEditor {...editorProps} onNext={navigation.onNext} />
      : tab === 'materials' ? <MaterialEditor {...editorProps} {...navigation} onEditorOpen={setEditorOpen} />
      : tab === 'questions' ? <QuestionEditor {...editorProps} {...navigation} />
      : tab === 'ecr' ? <>{stage === 'eco' && <SourceOverview record={record} />}<EcrEditor {...editorProps} {...navigation} onEditorOpen={setEditorOpen} /></>
      : tab === 'eco' ? stage === 'ecr' ? <InactiveEcoSheet record={record} leaving={props.leaving || issueBusy || publicationBusy || fillerBusy} onEditorOpen={setEditorOpen} /> : <EcoEditor {...editorProps} {...navigation} onEditorOpen={setEditorOpen} />
      : tab === 'emc' ? <EmcEditor {...editorProps} {...navigation} onEditorOpen={setEditorOpen} />
      : tab === 'execution-plan' ? <ExecutionPlanEditor {...editorProps} {...navigation} />
      : tab === 'significant-change' ? <SignificantChangeEditor {...editorProps} {...navigation} onEditorOpen={setEditorOpen} />
      : tab === 'submission' ? <SubmissionEditor {...editorProps} reviewDraftDirty={issueDirty} onPrevious={() => switchTab('summary')} />
      : <Alert type="info" title={record.current_review_round ? props.reviewOnly ? '本流程审核与意见请使用上方审核面板。' : '本流程的轮次、意见回应及原提出者复核见下方。' : '本流程尚未提交，没有审核轮次或正式意见。'} />
  return <>
    <div className="process-heading"><div><span className="eyebrow">独立{label}流程</span><h1>{(stage === 'eco' ? record.eco_no : record.ecr_no) || '编号待填写'} · {record.title || '未命名工程变更'} <Tag color={stateColors[record.status]}>{processStates[record.status]}</Tag></h1>{stage === 'eco' && <p className="muted">来源ECR：{record.source_ecr_no} · 已发布结果只读，本ECO独立填写、审核及发布。</p>}</div>{!props.reviewOnly && <Button disabled={blocked} onClick={props.onBack}>{backLabel(client)}</Button>}</div>
    <div className="process-layout"><aside className="panel process-sidebar"><Menu selectedKeys={[tab]} mode="inline" items={items} onClick={({ key }) => switchTab(key)} /></aside><section className="process-body">{content}
      {!props.reviewOnly && !!record.current_review_round && <div style={{ display: ['summary', 'history'].includes(tab) ? undefined : 'none' }}><ReviewPanel compact={tab !== 'history'} initialOpen={props.initialReviewOpen} key={`${record.id}:${record.current_review_round}`} changeId={record.id} number={record.current_review_round} leaving={props.leaving || busy || confirming || publicationBusy || fillerBusy} onReauthenticate={props.onReauthenticate} onBusy={value => { setIssueBusy(value); props.onBusy(value || busy || publicationBusy || fillerBusy) }} onDirty={value => { setIssueDirty(value); props.onDirty(value || dirty) }} /></div>}
    </section></div>
  </>
}

function Workspace() {
  const queryClient = useQueryClient()
  const { message } = AntApp.useApp()
  useEffect(() => {
    const refreshIdentity = () => { message.warning('登录账号已变化，本次操作未执行，正在切换工作台。'); void queryClient.invalidateQueries({ queryKey: ['me'] }) }
    const refreshFeedbackPermission = (event: Event) => {
      const expectedUserId = (event as CustomEvent<{ expectedUserId?: number }>).detail?.expectedUserId
      const current = queryClient.getQueryData<User>(['me'])
      if (expectedUserId === undefined || current?.id !== expectedUserId) return
      message.warning('反馈管理权限已变化，正在刷新身份；当前表单保持。')
      queryClient.setQueryData<User>(['me'], (current) => current ? { ...current, can_manage_feedback: false } : current)
      queryClient.removeQueries({ predicate: (query) => ['system-feedback-list', 'system-feedback-detail'].includes(String(query.queryKey[0])) && query.queryKey[1] === expectedUserId && query.queryKey[2] === 'manage' })
      void queryClient.invalidateQueries({ queryKey: ['me'] })
    }
    window.addEventListener('account-changed', refreshIdentity)
    window.addEventListener('feedback-permission-changed', refreshFeedbackPermission)
    return () => { window.removeEventListener('account-changed', refreshIdentity); window.removeEventListener('feedback-permission-changed', refreshFeedbackPermission) }
  }, [queryClient, message])
  const user = useQuery({
    queryKey: ['me'], queryFn: async () => {
      try { return await api<User>('/api/auth/me/') }
      catch (error) { if (error instanceof ApiError && error.status === 401 && !queryClient.getQueryData(['me'])) return null; throw error }
    }, retry: false, refetchOnWindowFocus: false,
  })
  if (user.isPending) return <div className="loading-page"><Spin tip="正在连接工作台…"><div className="loading-space" /></Spin></div>
  if (user.data) return <AuthenticatedWorkspace key={user.data.id} user={user.data} error={user.error} fetching={user.isFetching} retry={() => { void user.refetch() }} />
  if (user.error) return <div className="connection-error"><Alert type="error" showIcon title="无法连接工作台" description={user.error.message} action={<Button onClick={() => void user.refetch()}>重试</Button>} /></div>
  return <div className="app-shell"><header className="topbar"><div className="brand"><span className="brand-mark">变</span><div><strong>表单填报系统</strong><span>设计变更工作台</span></div></div></header><Login onLogin={(currentUser) => {
    queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'me' })
    queryClient.setQueryData(['me'], currentUser)
  }} /></div>
}

type BusinessWorkspaceProps = { user: User; feedbackRef: RefObject<FeedbackHandle | null>; reauthenticate: boolean; reauthBusy: boolean; onReauthenticate: () => void; onLeaving: (leaving: boolean) => void }

function AuthenticatedWorkspace({ user, error, fetching, retry }: { user: User; error: Error | null; fetching: boolean; retry: () => void }) {
  const queryClient = useQueryClient(), feedbackRef = useRef<FeedbackHandle>(null)
  const [reauthenticate, setReauthenticate] = useState(false), [reauthBusy, setReauthBusy] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const workspaceProps = { user, feedbackRef, reauthenticate, reauthBusy, onReauthenticate: () => setReauthenticate(true), onLeaving: setLeaving }
  return <>
    <UserWorkspace {...workspaceProps} sessionError={error} sessionFetching={fetching} retrySession={retry} />
    <SystemFeedbackPanel user={user} handleRef={feedbackRef} leaving={leaving || reauthenticate} onReauthenticate={() => setReauthenticate(true)} />
    <Modal open={reauthenticate} title="重新登录" footer={null} destroyOnHidden closable={!reauthBusy} maskClosable={false} keyboard={!reauthBusy} onCancel={() => setReauthenticate(false)}>
      <p className="muted">使用原账号可继续系统反馈；切换账号会关闭原申请和反馈草稿。</p>
      <Login compact onBusy={setReauthBusy} onLogin={(current) => {
        if (current.id !== user.id) queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'me' })
        queryClient.setQueryData(['me'], current)
        setReauthenticate(false)
        if (current.id === user.id) window.dispatchEvent(new Event('editor-reauthenticated'))
        for (const resource of ['changes', 'change', 'materials', 'questions', 'ecr-actions', 'eco-actions', 'emc', 'execution-plan', 'significant-change', 'submission', 'stage-workflow', 'publication', 'publications', 'ecr-publications', 'stage-navigation', 'source-ecr', 'reviewers', 'review-list', 'review-round', 'review-inbox', 'system-feedback-list', 'system-feedback-detail']) void queryClient.invalidateQueries({ queryKey: [resource, current.id] })
      }} />
    </Modal>
  </>
}

function UserWorkspace({ user, sessionError, retrySession, sessionFetching, feedbackRef, reauthenticate, reauthBusy, onReauthenticate, onLeaving }: BusinessWorkspaceProps & { sessionError: Error | null; sessionFetching: boolean; retrySession: () => void }) {
  const queryClient = useQueryClient()
  const { modal, message } = AntApp.useApp()
  const [section, setSection] = useState<'home' | 'mine' | 'review'>('home')
  const [reviewTarget, setReviewTarget] = useState<{ id: number; number: number; showIssues?: boolean } | null>(null)
  const reviewAllowed = canReview(user)
  useEffect(() => { queryClient.setQueryData(['workspace-section'], section); return () => { queryClient.removeQueries({ queryKey: ['workspace-section'] }) } }, [section, queryClient])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [inboxTargetId, setInboxTargetId] = useState<number | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [leaveMessage, setLeaveMessage] = useState(discardSavedWarning)
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => { if (dirty || saving || confirming) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', protect)
    return () => window.removeEventListener('beforeunload', protect)
  }, [dirty, saving, confirming])
  const [processFilter, setProcessFilter] = useState<ProcessFilter>('ecr'), [statusFilter, setStatusFilter] = useState('all')
  const detail = useQuery({ queryKey: ['change', user.id, selectedId], queryFn: async () => {
    const result = await api<ChangeRequest>('/api/changes/' + selectedId + '/', 'GET', undefined, user.id)
    return newestResponse(queryClient.getQueryData<ChangeRequest>(['change', user.id, selectedId]), result)
  }, enabled: section === 'mine' && selectedId !== null, refetchOnWindowFocus: false })
  const create = useMutation({
    mutationFn: () => api<ChangeRequest>('/api/changes/', 'POST', {}, user.id),
    onSuccess: (record) => { queryClient.setQueryData(['change', user.id, record.id], record); setInboxTargetId(null); setSelectedId(record.id); setDirty(false); void queryClient.invalidateQueries({ queryKey: ['changes', user.id] }) },
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
  useEffect(() => { onLeaving(exit.isPending || confirming); return () => onLeaving(false) }, [exit.isPending, confirming, onLeaving])
  useEffect(() => {
    const handedOff = (event: Event) => {
      const detail = (event as CustomEvent<{ actor_id: number; change_id: number }>).detail
      if (detail.actor_id !== user.id || detail.change_id !== selectedId) return
      setSelectedId(null); setDirty(false); setSaving(false); setSection('mine')
      void queryClient.invalidateQueries({ queryKey: ['changes', user.id] })
    }
    window.addEventListener('eco-filler-handed-off', handedOff)
    return () => window.removeEventListener('eco-filler-handed-off', handedOff)
  }, [user.id, selectedId, queryClient])
  const listBusy = create.isPending || exit.isPending || remove.isPending || reauthBusy
  const navigateApplication = (action: () => void) => {
    if (saving || listBusy || confirming || reauthenticate) return
    if (!dirty) { action(); return }
    setConfirming(true)
    modal.confirm({ title: '离开前放弃未保存的修改？', content: leaveMessage, okText: '放弃修改并离开', cancelText: '继续填写', onOk: () => { setConfirming(false); action() }, onCancel: () => setConfirming(false) })
  }
  const navigate = (action: () => void) => feedbackRef.current?.leave((discard) => navigateApplication(() => { discard(); action() }))
  const changeSection = (next: 'home' | 'mine' | 'review') => navigate(() => {
    setDirty(false); setSaving(false); setInboxTargetId(null); setSelectedId(null); setReviewTarget(null); setSection(next)
    if (next === 'mine') void queryClient.invalidateQueries({ queryKey: ['changes', user.id] })
  })
  useEffect(() => {
    const openMessage = (event: Event) => {
      const { actor_id, item, onOpened } = (event as CustomEvent<InboxNavigation>).detail
      if (actor_id !== user.id) return
      if (saving || listBusy || confirming || reauthenticate) { message.warning('请先确认当前操作结果再切换申请。'); return }
      if (item.context === 'applicant' && section === 'mine' && selectedId === item.change_id) { onOpened(); if (item.open_issues) openReviewDrawer(); return }
      if (item.context === 'reviewer' && !reviewAllowed) { void retrySession(); return }
      if (item.context === 'reviewer' && section === 'review' && reviewTarget?.id === item.change_id && reviewTarget.number === item.round) {
        onOpened(); if (item.open_issues) openReviewDrawer()
        void queryClient.invalidateQueries({ queryKey: ['review-round', user.id, item.change_id, item.round] })
        return
      }
      navigate(() => {
        setDirty(false); setSaving(false)
        if (item.context === 'reviewer') { setSelectedId(null); setSection('review'); setReviewTarget({ id: item.change_id, number: item.round, showIssues: item.open_issues }) }
        else { setReviewTarget(null); setSection('mine'); setInboxTargetId(item.open_issues ? item.change_id : null); setSelectedId(item.change_id) }
        onOpened()
      })
    }
    window.addEventListener(inboxNavigationEvent, openMessage)
    return () => window.removeEventListener(inboxNavigationEvent, openMessage)
  })
  return <div className="app-shell">
    <header className="topbar"><div className="brand"><span className="brand-mark">变</span><div><strong>表单填报系统</strong><span>设计变更工作台</span></div></div>{user && <div className="user-menu"><span>{user.display_name}</span>{user.can_manage_feedback && <Button onClick={() => feedbackRef.current?.manage()}>反馈管理</Button>}<Button disabled={saving || listBusy} onClick={retrySession}>刷新身份</Button><Button disabled={saving || listBusy} onClick={onReauthenticate}>重新登录</Button><Button type="text" loading={exit.isPending} disabled={saving || listBusy} onClick={() => navigate(() => exit.mutate())}>退出登录</Button></div>}</header>
    <main className="workspace">
      {sessionError && <Alert type="error" showIcon title="登录信息刷新失败，当前填写内容仍保留" description={sessionError.message} className="form-alert" action={<Button loading={sessionFetching} disabled={saving || exit.isPending} onClick={retrySession}>重试</Button>} />}
      {exit.error && <Alert type="error" title={exit.error.message} className="form-alert" />}
      <nav className="workspace-navigation"><Button type={section === 'home' ? 'primary' : 'default'} disabled={saving || listBusy || confirming} onClick={() => changeSection('home')}>工作台</Button><Button type={section === 'mine' ? 'primary' : 'default'} disabled={saving || listBusy || confirming} onClick={() => changeSection('mine')}>工程变更</Button><Button type={section === 'review' ? 'primary' : 'default'} disabled={saving || listBusy || confirming || !reviewAllowed} onClick={() => changeSection('review')}>待我处理</Button></nav>
      {section === 'home' ? <>
        <div className="page-heading"><div><span className="eyebrow">工作台</span><h1>{user.display_name}，欢迎回来</h1><p className="muted">在这里发起自己的变更申请{reviewAllowed ? '，也可以处理交给你的审核事项。' : '。'}</p></div></div>
        <div className="workspace-cards"><button className="workspace-card panel" disabled={listBusy} onClick={() => changeSection('mine')}><span className="workspace-card-icon">＋</span><h2>工程变更</h2><p className="muted">发起ECR，关联查看独立ECO，或继续填写有权处理的流程。</p><span className="workspace-card-link">进入工程变更 →</span></button>
          {reviewAllowed && <button className="workspace-card panel" disabled={listBusy} onClick={() => changeSection('review')}><span className="workspace-card-icon">✓</span><h2>待我处理</h2><p className="muted">处理自己的ECR／ECO任务、意见复核、批准和发布。</p><span className="workspace-card-link">进入待我处理 →</span></button>}</div>
      </> : section === 'review' ? reviewAllowed ? <ReviewWorkbench user={user} target={reviewTarget} onSelect={setReviewTarget} leaving={exit.isPending || reauthenticate || confirming} onReauthenticate={onReauthenticate} onBusy={setSaving} onDirty={setDirty} renderForm={(record, onBack, formState) => <ConfigProvider theme={reviewReadOnlyTheme}><ChangeEditor key={record.id} reviewOnly record={record} onOpenChange={id => navigate(() => { setReviewTarget(null); setSection('mine'); setSelectedId(id) })} onDirty={formState.onDirty} onBusy={formState.onBusy} onLeaveMessage={() => {}} leaving={formState.leaving} onReauthenticate={onReauthenticate} onBack={onBack} onSaved={() => {}} /></ConfigProvider>} /> : <Alert type="warning" title="处理权限已撤销，不能继续访问他人申请。" action={<Button onClick={() => changeSection('home')}>返回工作台首页</Button>} /> : selectedId === null ? <>
        {create.error && <Alert type="error" title={create.error.message} className="form-alert" />}
        {remove.error && <Alert type="error" showIcon title={remove.error instanceof ApiError && remove.error.status === 404 ? '申请已不存在或不可访问，列表已刷新' : '删除失败，申请记录仍保留'} description={remove.error instanceof ApiError && remove.error.status === 404 ? undefined : remove.error.message} className="form-alert" />}
        <EngineeringChanges user={user} workflow={processFilter} state={statusFilter} onWorkflow={setProcessFilter} onState={setStatusFilter} busy={listBusy} creating={create.isPending} removing={remove.isPending ? remove.variables : undefined} onCreate={() => create.mutate()} onOpen={id => setSelectedId(id)} onDelete={row => { remove.reset(); modal.confirm({ title: '删除这条ECR草稿？', content: <><p>{row.title || '未命名工程变更'}</p><p>ECR：{row.ecr.number || '未填写'}</p><p>该ECR草稿及关联填写数据将永久删除，无法恢复。</p></>, okText: '永久删除', cancelText: '取消', okButtonProps: { danger: true }, onOk: async () => { try { await remove.mutateAsync(row.id) } catch { /* Render the error beside the list. */ } } }) }} />
      </> : detail.data ? <>
        {detail.error && <Alert type="error" showIcon title="申请信息刷新失败，当前填写内容仍保留" description={detail.error.message} className="form-alert" action={<Button loading={detail.isFetching} disabled={saving || exit.isPending} onClick={() => void detail.refetch()}>重试</Button>} />}
        <ChangeEditor onOpenChange={id => navigate(() => { setInboxTargetId(null); setSelectedId(id) })} initialReviewOpen={inboxTargetId === selectedId} onLeaveMessage={setLeaveMessage} key={selectedId} record={detail.data} onDirty={setDirty} onBusy={setSaving} leaving={exit.isPending || reauthenticate || confirming} onReauthenticate={onReauthenticate} onBack={() => navigate(() => { setDirty(false); setInboxTargetId(null); setSelectedId(null); void queryClient.invalidateQueries({ queryKey: ['changes', user.id] }) })} onSaved={(record) => { queryClient.setQueryData<ChangeRequest>(['change', user.id, record.id], (current) => newestResponse(current, record)); void queryClient.invalidateQueries({ queryKey: ['changes', user.id] }) }} />
      </> : detail.isPending ? <Spin tip="正在读取草稿…"><div className="loading-space" /></Spin> : <Alert type="error" title={detail.error?.message ?? '无法读取申请。'} action={<><Button loading={detail.isFetching} disabled={exit.isPending} onClick={() => void detail.refetch()}>重试</Button><Button disabled={exit.isPending} onClick={() => { setSelectedId(null); setDirty(false) }}>返回列表</Button></>} />}
      <footer className="workspace-footer"><span className="muted">ECR与ECO分别填写、审核及发布；ECO从已发布ECR启动，两份流程保持数据和历史独立。</span></footer>
    </main>
  </div>
}

export default function App() {
  return <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#176b5b', borderRadius: 8, fontFamily: '"Segoe UI", "Microsoft YaHei", sans-serif', controlHeight: 40 } }}><AntApp>{new URLSearchParams(window.location.search).get('preview') === 'ecr' ? <EcrPreview /> : <Workspace />}</AntApp></ConfigProvider>
}
