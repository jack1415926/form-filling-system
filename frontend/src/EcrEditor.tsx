import { newestResponse } from './latestResponse'
import DateInput from './DateInput'
import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Drawer, Empty, Input, Select, Table, Tag } from 'antd'
import { api, type ChangeRequest, type EcrAction, type EcrData, type EcrValues } from './api'
import useAutosave, { discardSavedWarning } from './useAutosave'
import { actionFields } from './autosaveFields'


const statusLabels = { '': '未填写', completed: '完成', not_applicable: '不适用' }
const statusOptions = Object.entries(statusLabels).map(([value, label]) => ({ value, label }))

function ActionForm({ action, record, leaving, paused, onDirty, onBusy, onSaved, onComplete }: {
  action: EcrAction; record: ChangeRequest; leaving: boolean; paused: boolean
  onDirty: (value: boolean) => void; onBusy: (value: boolean) => void; onSaved: (data: EcrData) => EcrData; onComplete: () => void
}) {
  const [dateInvalid, setDateInvalid] = useState(false)
  const save = useAutosave({
    fields: actionFields(action), enabled: record.status === 'draft' && !leaving, valid: !dateInvalid, paused, onDirty, onBusy,
    send: async (patch) => {
      const data = await api<EcrData>(`/api/changes/${record.id}/ecr-actions/${action.id}/`, 'PATCH', patch, record.applicant)
      const latest = save.queue.active ? onSaved(data) : data
      return actionFields(latest.actions.find((row) => row.id === action.id)!)
    },
  })
  const values = save.values as EcrValues
  const dirty = save.dirty
  const update = (next: Partial<EcrValues>) => save.update(next)
  const disabled = record.status !== 'draft' || leaving || save.manual
  const manualSave = () => { void save.manualSave().then(onComplete).catch(() => {}) }
  return <div className="preview-drawer" {...save.composition}>
    <Tag>{action.function}</Tag><p className="question-text">{action.text}</p>
    {record.status !== 'draft' && <Alert type="info" title="申请已锁定，仅供查看。" />}
    <label htmlFor="ecr-owner">负责人</label><Input id="ecr-owner" maxLength={255} disabled={disabled} value={values.owner} onChange={(event) => update({ owner: event.target.value })} />
    <label htmlFor="ecr-result">评估结果</label><Input.TextArea id="ecr-result" disabled={disabled} value={values.result} autoSize={{ minRows: 5, maxRows: 12 }} onChange={(event) => update({ result: event.target.value })} />
    <div className="form-grid"><div><label htmlFor="ecr-status">评估状态</label><Select id="ecr-status" style={{ width: '100%' }} disabled={disabled} options={statusOptions} value={values.status} onChange={(status: EcrValues['status']) => update({ status })} /></div><div><label htmlFor="ecr-date">日期</label><DateInput id="ecr-date" disabled={disabled} value={values.date ?? ''} onChange={(event) => { const invalid = event.target.validity.badInput; setDateInvalid(invalid); if (!invalid) update({ date: event.target.value || null }) }} /></div></div>
    {save.error && <Alert type="error" showIcon title="保存失败，填写内容仍保留" description={save.error.message} className="form-alert" />}
    <div className="form-footer"><span className={dirty ? 'save-status unsaved' : 'save-status'}>{save.status}</span><Button type="primary" disabled={disabled || !dirty || dateInvalid} loading={save.manual} onClick={manualSave}>保存评估</Button></div>
  </div>
}

export default function EcrEditor({ record, onDirty, onBusy, onBack, onPrevious, onNext, leaving, onReauthenticate, onEditorOpen }: {
  record: ChangeRequest; onDirty: (value: boolean) => void; onBusy: (value: boolean) => void
  onBack: () => void; onPrevious: () => void; onNext: () => void; leaving: boolean; onReauthenticate: () => void; onEditorOpen: (value: boolean) => void
}) {
  const { modal, message } = App.useApp()
  const queryClient = useQueryClient()
  const [editor, setEditor] = useState<EcrAction | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [all, setAll] = useState(false)
  const queryKey = ['ecr-actions', record.applicant, record.id]
  const actions = useQuery({ queryKey, refetchOnWindowFocus: false, queryFn: async () => {
    const result = await api<EcrData>(`/api/changes/${record.id}/ecr-actions/`, 'GET', undefined, record.applicant)
    const current = queryClient.getQueryData<EcrData>(queryKey)
    return newestResponse(current, result)
  } })
  useEffect(() => { onEditorOpen(!!editor); return () => onEditorOpen(false) }, [editor, onEditorOpen])
  const busy = saving || leaving
  const close = () => {
    if (busy) return
    const discard = () => { setEditor(null); setDirty(false); onDirty(false) }
    if (!dirty) { discard(); return }
    setConfirming(true)
    modal.confirm({ content: discardSavedWarning, onCancel: () => setConfirming(false), title: '放弃未保存的评估修改？', okText: '放弃修改', cancelText: '继续填写', onOk: () => { setConfirming(false); discard() } })
  }
  const rows = (actions.data?.actions ?? []).filter((row) => all || row.question_answer === 'Y')
  return <>
    <div className="page-heading"><div><span className="eyebrow">申请 #{record.id}</span><h1>ECR 评估行动</h1><p className="muted">默认只显示已保存问题回答为“是”的行动；未触发内容可在全部行动中查看。</p></div><Button disabled={busy} onClick={onBack}>返回我的申请</Button></div>
    {actions.error && <Alert type="error" showIcon title={actions.data ? '评估刷新失败，当前内容仍保留' : '无法读取 ECR 评估'} description={actions.error.message} className="form-alert" action={<Button disabled={busy} loading={actions.isFetching} onClick={() => void actions.refetch()}>重试</Button>} />}
    <section className="panel list-panel"><div className="section-heading"><h2>ECR 评估行动</h2><Select aria-label="行动筛选" disabled={busy || !!editor} style={{ width: 190 }} value={all ? 'all' : 'relevant'} options={[{ value: 'relevant', label: '当前触发' }, { value: 'all', label: '全部行动' }]} onChange={(value) => setAll(value === 'all')} /></div>
      <Table<EcrAction> rowKey="id" pagination={false} loading={actions.isPending} dataSource={rows} scroll={{ x: 1035 }} locale={{ emptyText: <Empty description={actions.error ? '读取失败，请重试' : '暂无当前触发的行动，可先保存问题答案或查看全部行动。'} /> }} columns={[
        { title: '来源问题', width: 160, render: (_, row) => <><strong>问题 {row.number}</strong><div className="preview-source"><Tag color={row.question_answer === 'Y' ? 'green' : 'default'}>{row.question_answer === 'Y' ? '当前触发' : row.question_answer === 'N' ? '当前未触发' : '来源问题未回答'}</Tag></div></> },
        { title: '职能', dataIndex: 'function', width: 125 },
        { title: 'ECR 评估行动', dataIndex: 'text', width: 380, render: (text: string) => <div className="question-text">{text}</div> },
        { title: '填写摘要', width: 280, render: (_, row) => <div className="preview-summary"><div>{row.owner || '未填负责人'} · {statusLabels[row.status]} · {row.date || '未填日期'}</div><p title={row.result}>{row.result ? row.result.slice(0, 100) : '未填写评估结果'}</p></div> },
        { title: '操作', width: 90, render: (_, row) => <Button type="link" disabled={busy || !!editor} onClick={() => setEditor(row)}>{record.status === 'draft' ? '编辑' : '查看'}</Button> },
      ]} />
    </section><div className="form-footer"><span className="muted">未触发时隐藏，不删除已有填写；触发后重新出现。</span><div className="form-actions"><Button disabled={busy || !!editor} onClick={onPrevious}>上一页</Button><Button disabled={busy || !!editor} onClick={onNext}>下一页</Button></div></div>
    <Drawer open={!!editor} size={720} title={editor && `问题 ${editor.number} · ECR 评估`} onClose={close} maskClosable={!busy} keyboard={!busy} closable={!busy} extra={<Button disabled={busy} onClick={onReauthenticate}>重新登录</Button>}>
      {editor && <ActionForm key={editor.id} action={actions.data?.actions.find((row) => row.id === editor.id) ?? editor} record={record} leaving={leaving} paused={confirming} onDirty={(value) => { setDirty(value); onDirty(value) }} onBusy={(value) => { setSaving(value); onBusy(value) }} onComplete={() => { setEditor(null); setDirty(false); message.success('已保存') }} onSaved={(data) => {
        const latest = newestResponse(queryClient.getQueryData<EcrData>(queryKey), data)
        queryClient.setQueryData(queryKey, latest)
        void queryClient.invalidateQueries({ queryKey: ['change', record.applicant, record.id] })
        void queryClient.invalidateQueries({ queryKey: ['changes', record.applicant] })
        return latest
      }} />}
    </Drawer>
  </>
}
