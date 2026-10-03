import { useImperativeHandle, useState, type Ref } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Input, Spin, Table } from 'antd'
import { api, ApiError, type ChangeRequest } from './api'
import DateInput from './DateInput'
import useAutosave from './useAutosave'
import type { SaveHandle } from './SaveBeforeSwitch'
import { newestResponse } from './latestResponse'
import { executionPlanFields, executionPlanPayload, invalidPlanRows, type PlanData, type PlanField, type PlanRow } from './executionPlanDraft'

type Props = {
  record: ChangeRequest; leaving: boolean; paused?: boolean; saveRef?: Ref<SaveHandle>
  onDirty: (value: boolean) => void; onBusy: (value: boolean) => void; onBack: () => void; onPrevious: () => void
}

function PlanForm({ data, record, leaving, paused, saveRef, onDirty, onBusy, onBack, onPrevious }: Props & { data: PlanData }) {
  const queryClient = useQueryClient()
  const [incomplete, setIncomplete] = useState<Set<string>>(new Set())
  const locked = record.status !== 'draft'
  const save = useAutosave({
    fields: executionPlanFields(data), enabled: !locked && !leaving, valid: (values) => !invalidPlanRows(values, data.rows, incomplete).length, paused, onDirty, onBusy,
    send: async (patch) => {
      if (invalidPlanRows(save.values, data.rows, incomplete).length) throw new ApiError(400, '请修正执行计划中的日期后保存。')
      const result = await api<PlanData>(`/api/changes/${record.id}/execution-plan/`, 'PATCH', executionPlanPayload(patch), record.applicant)
      const key = ['execution-plan', record.applicant, record.id]
      const latest = newestResponse(queryClient.getQueryData<PlanData>(key), result)
      if (save.queue.active) {
        queryClient.setQueryData(key, latest)
        void queryClient.invalidateQueries({ queryKey: ['change', record.applicant, record.id] })
        void queryClient.invalidateQueries({ queryKey: ['changes', record.applicant] })
      }
      return executionPlanFields(latest)
    },
  })
  useImperativeHandle(saveRef, () => ({ save: save.manualSave }))
  const invalid = invalidPlanRows(save.values, data.rows, incomplete)
  const busy = save.pending || save.manual || leaving
  const disabled = locked || leaving || save.manual
  const update = (id: string, field: PlanField, value: string | null) => {
    const changed = { [`${id}.${field}`]: value }
    save.update(changed)
  }
  const date = (row: PlanRow, field: 'start_date' | 'end_date') => <DateInput
    aria-label={`${row.activity}${field === 'start_date' ? '开始时间' : '结束时间'}`}
    id={`${row.id}-${field}`} disabled={disabled} value={save.values[`${row.id}.${field}`] ?? ''}
    onChange={(event) => {
      const key = `${row.id}.${field}`, bad = event.target.validity.badInput
      setIncomplete((current) => { const next = new Set(current); if (bad) next.add(key); else next.delete(key); return next })
      if (!bad) update(row.id, field, event.target.value || null)
    }} />
  const saveButton = <Button type="primary" loading={save.manual} disabled={disabled || !save.dirty || !!invalid.length} onClick={save.clickSave}>保存执行计划</Button>
  return <div {...save.composition}>
    <div className="page-heading"><div><span className="eyebrow">申请 #{record.id} · Part E</span><h1>设计变更执行计划</h1><p className="muted">活动固定，日期精确到日。两端都填写时，结束日期不得早于开始日期。</p></div><div className="form-actions">{saveButton}<Button disabled={busy} onClick={onBack}>返回我的申请</Button></div></div>
    {locked && <Alert type="info" title="申请已锁定，执行计划仅供查看。" className="form-alert" />}
    <section className="panel list-panel">
      <div className="section-heading"><h2>变更计划执行表</h2><span className="muted">ECR：{record.ecr_no || '未填写'} · QR-216-004 E</span></div>
      <Table<PlanRow> rowKey="id" pagination={false} dataSource={data.rows} scroll={{ x: 1100 }} columns={[
        { title: '活动', dataIndex: 'activity', width: 250, render: (text: string) => <div className="question-text">{text}</div> },
        { title: '责任人', width: 155, render: (_, row) => <Input id={`${row.id}-owner`} aria-label={`${row.activity}责任人`} disabled={disabled} maxLength={255} value={save.values[`${row.id}.owner`] ?? ''} onChange={(event) => update(row.id, 'owner', event.target.value)} /> },
        { title: '开始时间', width: 175, render: (_, row) => date(row, 'start_date') },
        { title: '结束时间', width: 175, render: (_, row) => <>{date(row, 'end_date')}{invalid.includes(row.id) && <p className="question-hint" role="alert">{incomplete.has(`${row.id}.start_date`) || incomplete.has(`${row.id}.end_date`) ? '请补全日期或清空全部日期部分。' : '结束日期不得早于开始日期。'}</p>}</> },
        { title: '备注', width: 345, render: (_, row) => <Input.TextArea id={`${row.id}-remark`} aria-label={`${row.activity}备注`} disabled={disabled} value={save.values[`${row.id}.remark`] ?? ''} autoSize={{ minRows: 2, maxRows: 6 }} onChange={(event) => update(row.id, 'remark', event.target.value)} /> },
      ]} />
      {save.error && <Alert type="error" showIcon title="保存失败，填写内容仍保留" description={save.error.message} className="form-alert" />}
      {!!invalid.length && <Alert type="warning" title="请修正标注行的日期后保存；其他填写内容仍保留。" className="form-alert" />}
      <div className="form-footer"><div><span className={save.dirty ? 'save-status unsaved' : 'save-status'}>{save.status}</span><p className="muted">最近保存：{new Date(data.updated_at).toLocaleString('zh-CN', { hour12: false })}</p></div><div className="form-actions"><Button disabled={busy} onClick={onPrevious}>上一页</Button>{saveButton}</div></div>
    </section>
  </div>
}

export default function ExecutionPlanEditor(props: Props) {
  const { record, leaving } = props
  const queryClient = useQueryClient()
  const queryKey = ['execution-plan', record.applicant, record.id]
  const query = useQuery({ queryKey, refetchOnWindowFocus: false, queryFn: async () => {
    const result = await api<PlanData>(`/api/changes/${record.id}/execution-plan/`, 'GET', undefined, record.applicant)
    return newestResponse(queryClient.getQueryData<PlanData>(queryKey), result)
  } })
  return <>
    {query.error && <Alert type="error" showIcon title={query.data ? '执行计划刷新失败，当前填写仍保留' : '无法读取执行计划'} description={query.error.message} className="form-alert" action={<Button disabled={leaving} loading={query.isFetching} onClick={() => void query.refetch()}>重试</Button>} />}
    {query.data ? <PlanForm {...props} data={query.data} /> : query.isPending ? <Spin tip="正在读取执行计划…"><div className="loading-space" /></Spin> : <Button disabled={leaving} onClick={props.onBack}>返回我的申请</Button>}
  </>
}
