import { newestResponse } from './latestResponse'
import DateInput from './DateInput'
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Drawer, Empty, Input, Select, Table, Tag } from 'antd'
import { api, type ChangeRequest, type EcoAction, type EcoData, type EcoValues } from './api'
import { saveResultUnconfirmed } from './questionDraft'
import { createEcoDraft, refreshEcoDraft } from './ecoDraft'

const statusLabels = { '': '未填写', completed: '完成', not_applicable: '不适用', implementation_stage: '在实施阶段完成' }
const statusOptions = Object.entries(statusLabels).map(([value, label]) => ({ value, label }))
const fields = ['owner', 'result', 'status', 'date'] as const

function ActionForm({ action, record, leaving, onDirty, onBusy, onSaved, dirty }: {
  action: EcoAction; record: ChangeRequest; leaving: boolean; dirty: boolean
  onDirty: (value: boolean) => void; onBusy: (value: boolean) => void; onSaved: (data: EcoData) => void
}) {
  const [draft, setDraft] = useState(() => createEcoDraft(action))
  const { values, baseline } = draft
  const [dateInvalid, setDateInvalid] = useState(false)
  const [unconfirmed, setUnconfirmed] = useState<(keyof EcoValues)[]>([])
  const { message } = App.useApp()
  const changed = (next: EcoValues) => fields.some((key) => next[key] !== baseline[key] || unconfirmed.includes(key))
  const patch = Object.fromEntries(fields.filter((key) => values[key] !== baseline[key] || unconfirmed.includes(key)).map((key) => [key, values[key]]))
  const save = useMutation({
    mutationFn: () => api<EcoData>(`/api/changes/${record.id}/eco-actions/${action.id}/`, 'PATCH', patch, record.applicant),
    onMutate: () => onBusy(true), onSettled: () => onBusy(false),
    onError: (error) => {
      if (saveResultUnconfirmed(error)) { setUnconfirmed((current) => [...new Set([...current, ...Object.keys(patch) as (keyof EcoValues)[]])]); onDirty(true) }
    },
    onSuccess: (data) => { onDirty(false); onSaved(data); message.success('ECO 执行已保存') },
  })
  const refreshed = refreshEcoDraft(draft, action, dirty, save.isPending, unconfirmed.length > 0)
  if (refreshed !== draft) setDraft(refreshed)
  const update = (next: Partial<EcoValues>) => { const result = { ...values, ...next }; setDraft({ ...draft, values: result }); onDirty(changed(result) || dateInvalid) }
  const disabled = record.status !== 'draft' || leaving || save.isPending
  return <div className="preview-drawer">
    <Tag>{action.function}</Tag><p className="question-text">{action.text}</p>
    {record.status !== 'draft' && <Alert type="info" title="申请已锁定，仅供查看。" />}
    <label htmlFor="eco-owner">负责人</label><Input id="eco-owner" maxLength={255} disabled={disabled} value={values.owner} onChange={(event) => update({ owner: event.target.value })} />
    <label htmlFor="eco-result">行动完成情况</label><p className="muted">需要注明变动文件编号、ECO相对ECR变化点等。</p><Input.TextArea id="eco-result" disabled={disabled} value={values.result} autoSize={{ minRows: 5, maxRows: 12 }} onChange={(event) => update({ result: event.target.value })} />
    <div className="form-grid"><div><label htmlFor="eco-status">状态</label><Select id="eco-status" style={{ width: '100%' }} disabled={disabled} options={statusOptions} value={values.status} onChange={(status: EcoValues['status']) => update({ status })} /></div><div><label htmlFor="eco-date">日期</label><DateInput id="eco-date" disabled={disabled} value={values.date ?? ''} onChange={(event) => { const invalid = event.target.validity.badInput; setDateInvalid(invalid); const result = invalid ? values : { ...values, date: event.target.value || null }; if (!invalid) setDraft({ ...draft, values: result }); onDirty(changed(result) || invalid) }} /></div></div>
    {save.error && <Alert type="error" showIcon title="保存失败，填写内容仍保留" description={save.error.message} className="form-alert" />}
    <div className="form-footer"><span className={dirty ? 'save-status unsaved' : 'save-status'}>{unconfirmed.length ? '上次保存结果未确认，请重试' : dirty ? '有未保存的修改' : '已保存'}</span><Button type="primary" disabled={disabled || !dirty || dateInvalid} loading={save.isPending} onClick={() => save.mutate()}>保存行动</Button></div>
  </div>
}

export default function EcoEditor({ record, onDirty, onBusy, onBack, onPrevious, onNext, leaving, onReauthenticate, onEditorOpen }: {
  record: ChangeRequest; onDirty: (value: boolean) => void; onBusy: (value: boolean) => void
  onBack: () => void; onPrevious: () => void; onNext: () => void; leaving: boolean; onReauthenticate: () => void; onEditorOpen: (value: boolean) => void
}) {
  const { modal } = App.useApp()
  const queryClient = useQueryClient()
  const [editor, setEditor] = useState<EcoAction | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [all, setAll] = useState(false)
  const queryKey = ['eco-actions', record.applicant, record.id]
  const actions = useQuery({ queryKey, refetchOnWindowFocus: false, queryFn: async () => {
    const result = await api<EcoData>(`/api/changes/${record.id}/eco-actions/`, 'GET', undefined, record.applicant)
    const current = queryClient.getQueryData<EcoData>(queryKey)
    return newestResponse(current, result)
  } })
  useEffect(() => { onEditorOpen(!!editor); return () => onEditorOpen(false) }, [editor, onEditorOpen])
  const busy = saving || leaving
  const close = () => {
    if (busy) return
    const discard = () => { setEditor(null); setDirty(false); onDirty(false) }
    if (!dirty) { discard(); return }
    modal.confirm({ title: '放弃未保存的行动修改？', okText: '放弃修改', cancelText: '继续填写', onOk: discard })
  }
  const rows = (actions.data?.actions ?? []).filter((row) => all || row.question_answer === 'Y')
  return <>
    <div className="page-heading"><div><span className="eyebrow">申请 #{record.id}</span><h1>ECO 执行</h1><p className="muted">默认只显示已保存问题回答为“是”的行动；未触发内容可在全部行动中查看。</p></div><Button disabled={busy} onClick={onBack}>返回我的申请</Button></div>
    {actions.error && <Alert type="error" showIcon title={actions.data ? '行动刷新失败，当前内容仍保留' : '无法读取 ECO 执行'} description={actions.error.message} className="form-alert" action={<Button disabled={busy} loading={actions.isFetching} onClick={() => void actions.refetch()}>重试</Button>} />}
    <section className="panel list-panel"><div className="section-heading"><h2>ECO 前完成的行动</h2><Select aria-label="行动筛选" disabled={busy || !!editor} style={{ width: 190 }} value={all ? 'all' : 'relevant'} options={[{ value: 'relevant', label: '当前触发' }, { value: 'all', label: '全部行动' }]} onChange={(value) => setAll(value === 'all')} /></div>
      <Table<EcoAction> rowKey="id" pagination={false} loading={actions.isPending} dataSource={rows} scroll={{ x: 1035 }} locale={{ emptyText: <Empty description={actions.error ? '读取失败，请重试' : '暂无当前触发的行动，可先保存问题答案或查看全部行动。'} /> }} columns={[
        { title: '来源问题', width: 160, render: (_, row) => <><strong>问题 {row.number}</strong><div className="preview-source"><Tag color={row.question_answer === 'Y' ? 'green' : 'default'}>{row.question_answer === 'Y' ? '当前触发' : row.question_answer === 'N' ? '当前未触发' : '来源问题未回答'}</Tag></div></> },
        { title: '职能', dataIndex: 'function', width: 125 },
        { title: 'ECO 前完成的行动', dataIndex: 'text', width: 380, render: (text: string) => <div className="question-text">{text}</div> },
        { title: '填写摘要', width: 280, render: (_, row) => <div className="preview-summary"><div>{row.owner || '未填负责人'} · {statusLabels[row.status]} · {row.date || '未填日期'}</div><p title={row.result}>{row.result ? row.result.slice(0, 100) : '未填写行动完成情况'}</p></div> },
        { title: '操作', width: 90, render: (_, row) => <Button type="link" disabled={busy || !!editor} onClick={() => setEditor(row)}>{record.status === 'draft' ? '编辑' : '查看'}</Button> },
      ]} />
    </section><div className="form-footer"><span className="muted">未触发时隐藏，不删除已有填写；触发后重新出现。</span><div className="form-actions"><Button disabled={busy || !!editor} onClick={onPrevious}>上一页</Button><Button disabled={busy || !!editor} onClick={onNext}>下一页</Button></div></div>
    <Drawer open={!!editor} size={720} title={editor && `问题 ${editor.number} · ECO 执行`} onClose={close} maskClosable={!busy} keyboard={!busy} closable={!busy} extra={<Button disabled={busy} onClick={onReauthenticate}>重新登录</Button>}>
      {editor && <ActionForm key={editor.id} action={actions.data?.actions.find((row) => row.id === editor.id) ?? editor} record={record} leaving={leaving} dirty={dirty} onDirty={(value) => { setDirty(value); onDirty(value) }} onBusy={(value) => { setSaving(value); onBusy(value) }} onSaved={(data) => {
        queryClient.setQueryData<EcoData>(queryKey, (current) => newestResponse(current, data))
        queryClient.setQueryData<ChangeRequest>(['change', record.applicant, record.id], (current) => current ? newestResponse(current, { ...current, updated_at: data.updated_at }) : current)
        void queryClient.invalidateQueries({ queryKey: ['changes', record.applicant] })
        setEditor(null); setDirty(false)
      }} />}
    </Drawer>
  </>
}
