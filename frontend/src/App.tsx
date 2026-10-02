import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App as AntApp, Button, ConfigProvider, Empty, Form, Input, Spin, Table, Tabs, Tag, Modal } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { api, ApiError, type ChangeRequest, type Overview, type User } from './api'
import './App.css'
import MaterialEditor from './MaterialEditor'
import QuestionEditor from './QuestionEditor'
import EcrPreview from './EcrPreview'
import EcrEditor from './EcrEditor'
import SaveBeforeSwitch, { type SaveHandle } from './SaveBeforeSwitch'

const stateLabels = { draft: '草稿', pending: '待审批', approved: '已批准' }
const stateColors = { draft: 'default', pending: 'gold', approved: 'green' }
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

function OverviewEditor({ record, onDirty, onSaved, onBack, onBusy, leaving, onNext, saveRef }: {
  record: ChangeRequest; onDirty: (dirty: boolean) => void; onSaved: (record: ChangeRequest) => void; onBack: () => void; onBusy: (busy: boolean) => void; leaving: boolean; onReauthenticate: () => void; onNext?: () => void
  saveRef?: Ref<SaveHandle>
}) {
  const [form] = Form.useForm<Overview>()
  const [savedAt, setSavedAt] = useState(record.updated_at)
  const [dirty, setDirty] = useState(false)
  const changedFields = useRef(new Set<keyof Overview>())
  const { message } = AntApp.useApp()
  const locked = record.status !== 'draft'
  const save = useMutation({
    onError: () => { message.error('保存失败，填写内容仍保留') },
    onMutate: () => onBusy(true),
    onSettled: () => onBusy(false),
    mutationFn: (values: Overview) => {
      const patch: Partial<Overview> = Object.fromEntries([...changedFields.current].map((key) => [key, values[key] ?? '']))
      if ('planned_eco_date' in patch) patch.planned_eco_date = patch.planned_eco_date || null
      return api<ChangeRequest>('/api/changes/' + record.id + '/', 'PATCH', patch, record.applicant)
    },
    onSuccess: (result) => {
      form.setFieldsValue({ ...result, planned_eco_date: result.planned_eco_date ?? '' })
      setSavedAt(result.updated_at)
      setDirty(false)
      changedFields.current.clear()
      onDirty(false)
      onSaved(result)
      message.success('草稿已保存')
    },
  })
  useImperativeHandle(saveRef, () => ({ save: async () => {
    if (locked || save.isPending || leaving) throw new Error('当前不能保存')
    const values = await form.validateFields()
    await save.mutateAsync(values)
  } }))
  const changed = (values: Partial<Overview>) => {
    for (const key of Object.keys(values) as (keyof Overview)[]) changedFields.current.add(key)
    setDirty(true)
    onDirty(true)
  }
  const fields: { key: keyof Overview; label: string; placeholder?: string }[] = [
    { key: 'ecr_no', label: 'ECR 编号', placeholder: '手动填写，例如 ECR-26010601' },
    { key: 'eco_no', label: 'ECO 编号', placeholder: '可稍后补充' },
    { key: 'affected_region', label: '受影响区域' },
    { key: 'initiating_factory', label: '发起变更的工厂（注册人）' },
    { key: 'ccb_owner', label: 'CCB 负责人' },
    { key: 'change_owner', label: '设计负责人／变更发起人' },
  ]
  return <>
    <div className="page-heading"><div><span className="eyebrow">申请 #{record.id}</span><h1>变更概述 <Tag color={stateColors[record.status]}>{stateLabels[record.status]}</Tag></h1><p className="muted">先记录基本信息，草稿可保存尚未填完整的内容。</p></div><Button onClick={onBack} disabled={save.isPending || leaving}>返回我的申请</Button></div>
    <section className="panel overview-panel">
      <div className="section-heading"><div><h2>概述基本信息</h2><p className="muted">申请者由登录账号确定，业务负责人单独填写。</p></div><span className={dirty ? 'save-status unsaved' : 'save-status'}>{save.isPending ? '正在保存…' : dirty ? '有未保存的修改' : '已保存'}</span></div>
      {locked && <Alert type="info" title="申请已锁定，概述仅供查看。" className="form-alert" />}
      <Form form={form} initialValues={{ ...record, planned_eco_date: record.planned_eco_date ?? '' }} layout="vertical" onValuesChange={changed} onFinish={(values) => save.mutate(values)} disabled={locked || save.isPending || leaving} requiredMark={false}>
        <Form.Item name="title" label="ECR/ECO 标题" rules={[{ max: 255, message: '标题最多 255 个字符' }]}><Input placeholder="填写这项设计变更的标题" maxLength={255} /></Form.Item>
        <Form.Item name="affected_products" label="受影响产品和型号"><Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} placeholder="填写涉及的产品及型号" /></Form.Item>
        <div className="form-grid">{fields.map((field) => <Form.Item key={field.key} name={field.key} label={field.label} rules={[{ max: field.key.endsWith('_no') ? 64 : 255, message: '内容超过允许长度' }]}><Input placeholder={field.placeholder} /></Form.Item>)}</div>
        <div className="form-grid"><Form.Item name="affected_factories" label="受影响工厂"><Input.TextArea autoSize={{ minRows: 2, maxRows: 5 }} /></Form.Item><Form.Item name="planned_eco_date" label="ECO 计划完成时间"><Input type="date" /></Form.Item></div>
        <Form.Item name="change_reason" label="变更原因"><Input.TextArea autoSize={{ minRows: 4, maxRows: 12 }} placeholder="说明变更来源、原因分析和解决措施" /></Form.Item>
        {save.error && <Alert type="error" showIcon title="保存失败，填写内容仍保留" description={save.error.message} className="form-alert" />}
        <div className="form-footer"><span className="muted">最近保存：{dateTime(savedAt)}</span><div className="form-actions"><Button type="primary" htmlType="submit" size="large" loading={save.isPending} disabled={locked || leaving}>保存草稿</Button><Button htmlType="button" size="large" disabled={save.isPending || leaving} onClick={onNext}>下一页</Button></div></div>
      </Form>
    </section>
  </>
}

function ChangeEditor(props: Parameters<typeof OverviewEditor>[0]) {
  const [tab, setTab] = useState('overview')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const saveRef = useRef<SaveHandle>(null)
  const { modal } = AntApp.useApp()
  useEffect(() => {
    const handleUnload = (event: BeforeUnloadEvent) => {
      if (dirty || busy) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', handleUnload)
    return () => window.removeEventListener('beforeunload', handleUnload)
  }, [dirty, busy])
  const editorProps = { ...props,
    saveRef,
    onDirty: (value: boolean) => { setDirty(value); props.onDirty(value) },
    onBusy: (value: boolean) => { setBusy(value); props.onBusy(value) },
  }
  const switchTab = (key: string) => {
    if (busy || editorOpen || props.leaving || key === tab) return
    const change = () => { setDirty(false); props.onDirty(false); setTab(key); window.scrollTo({ top: 0 }) }
    if (!dirty) { change(); return }
    if (!saveRef.current) {
      modal.confirm({ title: '切换前放弃未保存的修改？', okText: '放弃修改并切换', cancelText: '继续填写', onOk: change })
      return
    }
    const dialog = modal.confirm({ title: '切换前有未保存的修改', keyboard: false, maskClosable: false, footer: () => <SaveBeforeSwitch
      save={async () => { if (!saveRef.current) throw new Error('编辑页面已关闭'); await saveRef.current.save() }}
      switchPage={change} discard={() => { change(); dialog.destroy() }} close={() => dialog.destroy()}
    /> })
  }
  return <><Tabs activeKey={tab} onChange={switchTab} items={[{ key: 'overview', label: '概述' }, { key: 'materials', label: '物料明细' }, { key: 'questions', label: '问题评估' }, { key: 'ecr', label: 'ECR 评估' }].map((item) => ({ ...item, disabled: busy || editorOpen || props.leaving }))} />
    {tab === 'overview' ? <OverviewEditor {...editorProps} onNext={() => switchTab('materials')} /> : tab === 'materials' ? <MaterialEditor {...editorProps} onEditorOpen={setEditorOpen} onNext={() => switchTab('questions')} /> : tab === 'questions' ? <QuestionEditor {...editorProps} onPrevious={() => switchTab('materials')} onNext={() => switchTab('ecr')} /> : <EcrEditor {...editorProps} onEditorOpen={setEditorOpen} onPrevious={() => switchTab('questions')} />}
  </>
}

function Workspace() {
  const queryClient = useQueryClient()
  const { message } = AntApp.useApp()
  useEffect(() => {
    const refreshIdentity = () => { message.warning('登录账号已变化，本次操作未执行，正在切换工作台。'); void queryClient.invalidateQueries({ queryKey: ['me'] }) }
    window.addEventListener('account-changed', refreshIdentity)
    return () => window.removeEventListener('account-changed', refreshIdentity)
  }, [queryClient, message])
  const user = useQuery({
    queryKey: ['me'], queryFn: async () => {
      try { return await api<User>('/api/auth/me/') }
      catch (error) { if (error instanceof ApiError && error.status === 401 && !queryClient.getQueryData(['me'])) return null; throw error }
    }, retry: false, refetchOnWindowFocus: false,
  })
  if (user.isPending) return <div className="loading-page"><Spin tip="正在连接工作台…"><div className="loading-space" /></Spin></div>
  if (user.data) return <UserWorkspace key={user.data.id} user={user.data} sessionError={user.error} sessionFetching={user.isFetching} retrySession={() => { void user.refetch() }} />
  if (user.error) return <div className="connection-error"><Alert type="error" showIcon title="无法连接工作台" description={user.error.message} action={<Button onClick={() => void user.refetch()}>重试</Button>} /></div>
  return <div className="app-shell"><header className="topbar"><div className="brand"><span className="brand-mark">变</span><div><strong>表单填报系统</strong><span>设计变更工作台</span></div></div></header><Login onLogin={(currentUser) => {
    queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'me' })
    queryClient.setQueryData(['me'], currentUser)
  }} /></div>
}

function UserWorkspace({ user, sessionError, retrySession, sessionFetching }: { user: User; sessionError: Error | null; retrySession: () => void; sessionFetching: boolean }) {
  const queryClient = useQueryClient()
  const { modal, message } = AntApp.useApp()
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [reauthenticate, setReauthenticate] = useState(false)
  const [reauthBusy, setReauthBusy] = useState(false)
  const records = useQuery({ queryKey: ['changes', user.id], queryFn: () => api<ChangeRequest[]>('/api/changes/', 'GET', undefined, user.id), enabled: !!user })
  const detail = useQuery({ queryKey: ['change', user.id, selectedId], queryFn: () => api<ChangeRequest>('/api/changes/' + selectedId + '/', 'GET', undefined, user.id), enabled: !!user && selectedId !== null, refetchOnWindowFocus: false })
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
    modal.confirm({ title: '离开前放弃未保存的修改？', content: '当前填写内容还没有保存。选择“继续填写”可返回保存。', okText: '放弃修改并离开', cancelText: '继续填写', onOk: action })
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
          { title: '操作', render: (_, record) => <div className="form-actions"><Button disabled={listBusy} onClick={() => setSelectedId(record.id)}>{record.status === 'draft' ? '继续填写' : '查看申请'}</Button>{record.status === 'draft' && <Button danger loading={remove.isPending && remove.variables === record.id} disabled={listBusy} onClick={() => { remove.reset(); modal.confirm({ title: '删除这条草稿申请？', content: <><p>{record.title || '未命名申请'}</p><p>ECR：{record.ecr_no || '未填写'}；ECO：{record.eco_no || '未填写'}</p><p>申请和所有已保存的关联数据会永久删除，无法恢复。</p></>, okText: '永久删除', cancelText: '取消', okButtonProps: { danger: true }, onOk: async () => { try { await remove.mutateAsync(record.id) } catch { /* Render the deletion error beside the list. */ } } }) }}>删除</Button>}</div> },
        ]} /></section>}
      </> : detail.data ? <>
        {detail.error && <Alert type="error" showIcon title="申请信息刷新失败，当前填写内容仍保留" description={detail.error.message} className="form-alert" action={<Button loading={detail.isFetching} disabled={saving || exit.isPending} onClick={() => void detail.refetch()}>重试</Button>} />}
        <ChangeEditor key={selectedId} record={detail.data} onDirty={setDirty} onBusy={setSaving} leaving={exit.isPending} onReauthenticate={() => setReauthenticate(true)} onBack={() => navigate(() => { setDirty(false); setSelectedId(null); void queryClient.invalidateQueries({ queryKey: ['changes', user.id] }) })} onSaved={(record) => { queryClient.setQueryData(['change', user.id, record.id], record); void queryClient.invalidateQueries({ queryKey: ['changes', user.id] }) }} />
      </> : detail.isPending ? <Spin tip="正在读取草稿…"><div className="loading-space" /></Spin> : <Alert type="error" title={detail.error?.message ?? '无法读取申请。'} action={<><Button loading={detail.isFetching} disabled={exit.isPending} onClick={() => void detail.refetch()}>重试</Button><Button disabled={exit.isPending} onClick={() => { setSelectedId(null); setDirty(false) }}>返回列表</Button></>} />}
      <footer className="workspace-footer"><span className="muted">当前提供概述、物料及处置、问题评估及 ECR 评估的填写与保存，其他表单内容将在后续阶段开放。</span></footer>
    </main>
    <Modal open={reauthenticate} title="重新登录" footer={null} destroyOnHidden closable={!reauthBusy} maskClosable={false} keyboard={!reauthBusy} onCancel={() => setReauthenticate(false)}>
      <p className="muted">使用原账号可继续当前填写；切换账号会关闭原申请。</p>
      <Login compact onBusy={setReauthBusy} onLogin={(currentUser) => {
        if (currentUser.id !== user.id) queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'me' })
        queryClient.setQueryData(['me'], currentUser)
        setReauthenticate(false)
        void queryClient.invalidateQueries({ queryKey: ['change', currentUser.id] })
        void queryClient.invalidateQueries({ queryKey: ['materials', currentUser.id] })
        void queryClient.invalidateQueries({ queryKey: ['questions', currentUser.id] })
        void queryClient.invalidateQueries({ queryKey: ['ecr-actions', currentUser.id] })
      }} />
    </Modal>
  </div>
}

export default function App() {
  return <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#176b5b', borderRadius: 8, fontFamily: '"Segoe UI", "Microsoft YaHei", sans-serif', controlHeight: 40 } }}><AntApp>{new URLSearchParams(window.location.search).get('preview') === 'ecr' ? <EcrPreview /> : <Workspace />}</AntApp></ConfigProvider>
}
