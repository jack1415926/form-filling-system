import { actorUser, canEdit, backLabel } from './workflow'
import { useEffect, useImperativeHandle, useState, type Ref } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Drawer, Input, Select, Spin, Table } from 'antd'
import { api, type ChangeRequest } from './api'
import useAutosave from './useAutosave'
import type { SaveHandle } from './SaveBeforeSwitch'
import { newestResponse } from './latestResponse'
import { significantFields, significantPayload, subResult, conclusionHint, needsConclusionReview, type SignificantData, type ChartRow, type SubRow, type Option } from './significantChangeDraft'
import type { Fields } from './autosave'

type Props = {
  record: ChangeRequest; leaving: boolean; paused?: boolean; saveRef?: Ref<SaveHandle>
  onDirty: (value: boolean) => void; onBusy: (value: boolean) => void; onEditorOpen: (value: boolean) => void
  onBack: () => void; onPrevious: () => void; onNext?: () => void; onReauthenticate: () => void
}
const applicabilityOptions = [{ value: '', label: '未填写' }, { value: 'Y', label: '适用' }, { value: 'N', label: '不适用' }]
const answerOptions = [{ value: '', label: '未回答' }, { value: 'Y', label: 'Y／是' }, { value: 'N', label: 'N／否' }]

function AssessmentForm({ data, record, leaving, paused, saveRef, onDirty, onBusy, onEditorOpen, onBack, onPrevious, onNext, onReauthenticate }: Props & { data: SignificantData }) {
  const queryClient = useQueryClient()
  const actorId = actorUser(queryClient).id
  const [chartId, setChartId] = useState<string | null>(null)
  const [review, setReview] = useState(false)
  const locked = !canEdit(record, actorUser(queryClient).role)
  const save = useAutosave({
    fields: significantFields(data), enabled: !locked && !leaving, paused, onDirty, onBusy,
    send: async (patch) => {
      const result = await api<SignificantData>(`/api/changes/${record.id}/significant-change/`, 'PATCH', significantPayload(patch), actorId)
      significantFields(result, significantFields(data))
      const key = ['significant-change', actorId, record.id]
      const latest = newestResponse(queryClient.getQueryData<SignificantData>(key), result)
      if (save.queue.active) {
        queryClient.setQueryData(key, latest)
        void queryClient.invalidateQueries({ queryKey: ['change', actorId, record.id] })
        void queryClient.invalidateQueries({ queryKey: ['changes', actorId] })
      }
      return significantFields(latest)
    },
  })
  useImperativeHandle(saveRef, () => ({ save: save.manualSave }))
  useEffect(() => { onEditorOpen(!!chartId); return () => onEditorOpen(false) }, [chartId, onEditorOpen])
  const disabled = locked || leaving || save.manual
  const busy = save.pending || save.manual || leaving
  const update = (patch: Fields) => {
    if (needsConclusionReview(save.values, patch)) setReview(true)
    save.update(patch)
  }
  const value = (key: string) => save.values[key] ?? ''
  const select = (key: string, label: string, options: Option[], blank = true, idPrefix = '', descriptionId?: string) => <Select
    id={idPrefix + key.replace('.', '-')} aria-label={label} aria-describedby={descriptionId} style={{ width: '100%' }} disabled={disabled} value={value(key)}
    options={blank ? [{ value: '', label: '未填写' }, ...options] : options} onChange={(next) => update({ [key]: next })} />
  const reason = (key: string, label: string) => <Input.TextArea
    id={key.replace('.', '-')} aria-label={label} disabled={disabled} value={value(key)} autoSize={{ minRows: 2, maxRows: 8 }} onChange={(event) => update({ [key]: event.target.value })} />
  const conclusion = (row: ChartRow, idPrefix = '') => {
    const hintId = `${idPrefix}chart-${row.id}-result-hint`
    return <div>{select(`chart_${row.id}.result`, idPrefix ? `子表 ${row.id}人工结论` : `Chart ${row.id}人工结论`, row.result_options, true, idPrefix, hintId)}<p id={hintId} className="assessment-result-hint">{conclusionHint(row, value(`chart_${row.id}.applicability`))}</p></div>
  }
  const chart = data.charts.find((row) => row.id === chartId)
  const saveButton = <Button type="primary" loading={save.manual} disabled={disabled || !save.dirty} onClick={save.clickSave}>保存评估</Button>
  const reviewMessage = review && <Alert type="warning" title="回答已调整，请核对组结论及最终结论" className="form-alert" />
  const error = save.error && <Alert type="error" showIcon title="保存失败，填写内容仍保留" description={save.error.message} className="form-alert" />
  return <div {...save.composition}>
    <div className="page-heading"><div><span className="eyebrow">申请 #{record.id} · Part F</span><h1>实质性变更评估</h1><p className="muted">逐题结果是原模板的分支提示；组结论与最终结论由人填写。</p></div><div className="form-actions">{saveButton}<Button disabled={busy} onClick={onBack}>{backLabel(queryClient)}</Button></div></div>
    {locked && <Alert type="info" title="申请已锁定，评估仅供查看。" className="form-alert" />}
    <section className="panel list-panel">
      <div className="section-heading"><h2>{data.title}</h2><span className={save.dirty ? 'save-status unsaved' : 'save-status'}>{save.status}</span></div>
      <div className="assessment-summary"><p><strong>ECR ID：</strong>{record.ecr_no || '未填写'}</p><p><strong>变更名称：</strong>{record.title || '未填写'}</p><p className="question-text"><strong>变更概述：</strong>{record.change_reason || '未填写'}</p></div>
      <Alert type="info" title="人工结论请在回答调整后重新核对；草稿允许暂未填完整。" className="form-alert" />
      {reviewMessage}
      <Table<ChartRow> rowKey="id" pagination={false} dataSource={data.charts} scroll={{ x: 1420 }} columns={[
        { title: 'Chart', dataIndex: 'id', width: 75 },
        { title: '评估内容', width: 350, render: (_, row) => <div className="question-text">{row.text}{row.id === '0' && <p className="question-hint">参考清单0.1～0.4待业务提供。</p>}</div> },
        { title: '适用／不适用', width: 140, render: (_, row) => select(`chart_${row.id}.applicability`, `Chart ${row.id}适用性`, applicabilityOptions, false) },
        { title: '原因', width: 220, render: (_, row) => reason(`chart_${row.id}.reason`, `Chart ${row.id}原因`) },
        { title: '下一步（原模板提示）', width: 250, render: (_, row) => <div className="question-text">{row.next_steps[value(`chart_${row.id}.applicability`)] || '—'}{row.id === 'B' && value('chart_B.applicability') === 'N' && <p className="question-hint">原模板提示，分支待业务确认；仍可继续填写C～E。</p>}{row.id !== '0' && <p><Button disabled={leaving || save.manual} onClick={() => setChartId(row.id)}>打开子表 {row.id}</Button></p>}</div> },
        { title: '子表评估结论（人工）', width: 285, render: (_, row) => row.id === '0' ? '—' : conclusion(row) },
      ]} />
      <div className="assessment-conclusion"><h3>F · {data.f_text}</h3>{select('assessment.f_assessment', 'F项评估', data.f_options)}<h3>Conclusion 结论（人工）</h3>{select('assessment.final_conclusion', '最终人工结论', data.final_options)}</div>
      {error}
      <div className="form-footer"><div><span className={save.dirty ? 'save-status unsaved' : 'save-status'}>{save.status}</span><p className="muted">最近保存：{new Date(data.updated_at).toLocaleString('zh-CN', { hour12: false })}</p></div><div className="form-actions"><Button disabled={busy} onClick={onPrevious}>上一页</Button>{saveButton}{onNext && <Button disabled={busy || !!chartId} onClick={onNext}>下一页</Button>}</div></div>
    </section>
    <Drawer open={!!chart} size="90vw" title={`Chart ${chartId ?? ''} · 实质性变更评估子表`} onClose={() => setChartId(null)} maskClosable={!save.manual && !leaving} keyboard={!save.manual && !leaving} closable={!save.manual && !leaving} extra={<Button disabled={busy} onClick={onReauthenticate}>重新登录</Button>}>
      {chart && <div {...save.composition}>
        <Alert type="info" title={`主表当前${applicabilityOptions.find((option) => option.value === value(`chart_${chart.id}.applicability`))?.label}；全部题目可查看，改变适用性不会删除填写。`} className="form-alert" />
        <details className="assessment-source-note"><summary>原表结论填写说明（保留原文）</summary><p className="question-text">{chart.validation_hint}</p><p className="question-hint">原文重复引用 Chart B，存在复制错误；填写请以当前结论下方的提示为准。</p></details>
        {reviewMessage}
        <Table<SubRow> rowKey="id" pagination={false} dataSource={data.questions.filter((row) => row.chart === chart.id)} scroll={{ x: 1100 }} columns={[
          { title: '题号', dataIndex: 'number', width: 90 },
          { title: '评估内容', width: 440, render: (_, row) => <div className="question-text">{row.text}{row.number === 'C-2' && <p className="question-hint">原表分组标题为“{row.source_title}”，按题号归入Chart C，标题待业务确认。</p>}</div> },
          { title: 'Y／N', width: 135, render: (_, row) => select(`${row.id}.answer`, `${row.number}回答`, answerOptions, false) },
          { title: '结果（原规则提示）', width: 235, render: (_, row) => <div className="question-text">{subResult(row, value(`${row.id}.answer`)) || '—'}</div> },
          { title: '原因', width: 260, render: (_, row) => reason(`${row.id}.reason`, `${row.number}原因`) },
        ]} />
        <div className="assessment-conclusion"><h3>Chart {chart.id} 评估结论（人工，与主表同步）</h3>{conclusion(chart, 'drawer-')}</div>
        {error}
        <div className="form-footer"><span className={save.dirty ? 'save-status unsaved' : 'save-status'}>{save.status}</span><div className="form-actions">{saveButton}<Button disabled={leaving || save.manual} onClick={() => setChartId(null)}>返回主表</Button></div></div>
      </div>}
    </Drawer>
  </div>
}

export default function SignificantChangeEditor(props: Props) {
  const queryClient = useQueryClient()
  const actorId = actorUser(queryClient).id
  const key = ['significant-change', actorId, props.record.id]
  const query = useQuery({ queryKey: key, refetchOnWindowFocus: false, queryFn: async () => {
    const result = await api<SignificantData>(`/api/changes/${props.record.id}/significant-change/`, 'GET', undefined, actorId)
    const previous = queryClient.getQueryData<SignificantData>(key)
    significantFields(result, previous && significantFields(previous))
    return newestResponse(queryClient.getQueryData<SignificantData>(key), result)
  } })
  return <>
    {query.error && <Alert type="error" showIcon title={query.data ? '评估刷新失败，当前填写仍保留' : '无法读取实质性变更评估'} description={query.error.message} className="form-alert" action={<Button disabled={props.leaving} loading={query.isFetching} onClick={() => void query.refetch()}>重试</Button>} />}
    {query.data ? <AssessmentForm {...props} data={query.data} /> : query.isPending ? <Spin tip="正在读取评估…"><div className="loading-space" /></Spin> : <Button disabled={props.leaving} onClick={props.onBack}>{backLabel(queryClient)}</Button>}
  </>
}
