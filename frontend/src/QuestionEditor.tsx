import { actorUser, canEdit, backLabel } from './workflow'
import { useImperativeHandle, type Ref } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Input, Select, Spin, Table } from 'antd'
import { api, type ChangeRequest, type Question, type QuestionAnswer, type QuestionData } from './api'
import useAutosave from './useAutosave'
import { questionFields, questionPayload } from './autosaveFields'
import type { SaveHandle } from './SaveBeforeSwitch'
import { newestResponse } from './latestResponse'

type Props = {
  record: ChangeRequest; onDirty: (value: boolean) => void; onBusy: (value: boolean) => void
  onBack: () => void; onPrevious: () => void; leaving: boolean
  onNext: () => void
  saveRef?: Ref<SaveHandle>; paused?: boolean
}

function QuestionForm({ data, record, onDirty, onBusy, onBack, onPrevious, onNext, saveRef, leaving, paused = false }: Props & { data: QuestionData }) {
  const queryClient = useQueryClient()
  const actorId = actorUser(queryClient).id
  const locked = !canEdit(record, actorUser(queryClient).role)
  const save = useAutosave({
    fields: questionFields(data), enabled: !locked && !leaving, paused, onDirty, onBusy,
    send: async (patch) => {
      const result = await api<QuestionData>(`/api/changes/${record.id}/questions/`, 'PATCH', questionPayload(patch), actorId)
      const key = ['questions', actorId, record.id]
      const latest = newestResponse(queryClient.getQueryData<QuestionData>(key), result)
      if (save.queue.active) {
        queryClient.setQueryData(key, latest)
        for (const name of ['ecr-actions', 'eco-actions', 'change', 'changes']) void queryClient.invalidateQueries({ queryKey: [name, actorId, ...(name === 'changes' ? [] : [record.id])] })
      }
      return questionFields(latest)
    },
  })
  useImperativeHandle(saveRef, () => ({ save: save.manualSave }))
  const dirty = save.dirty
  const busy = save.pending || save.manual || leaving
  const disabled = locked || save.manual || leaving
  const rows = data.questions.map((row) => ({ ...row, answer: save.values[`${row.number}.answer`] as QuestionAnswer, remark: save.values[`${row.number}.remark`] ?? '' }))
  const update = (number: number, fields: Partial<Pick<Question, 'answer' | 'remark'>>) => save.update(Object.fromEntries(Object.entries(fields).map(([key, value]) => [`${number}.${key}`, value])))
  const groups = [...new Set(rows.map((row) => row.function))]
  return <div {...save.composition}>
    <div className="page-heading"><div><span className="eyebrow">申请 #{record.id}</span><h1>问题评估</h1><p className="muted">未回答与否分别保存；缺少条件性理由时会提示，仍可保存草稿。</p></div><div className="form-actions"><Button type="primary" loading={save.manual} disabled={locked || save.manual || leaving || !dirty} onClick={save.clickSave}>保存草稿</Button><Button disabled={busy} onClick={onBack}>{backLabel(queryClient)}</Button></div></div>
    {locked && <Alert type="info" title="申请已锁定，问题评估仅供查看。" className="form-alert" />}
    {groups.map((group) => <section className="panel list-panel question-section" key={group}>
      <div className="section-heading"><h2>{group}</h2></div>
      <Table<Question> rowKey="number" pagination={false} scroll={{ x: 880 }} dataSource={rows.filter((row) => row.function === group)} columns={[
        { title: '题号', dataIndex: 'number', width: 65 },
        { title: '问题', dataIndex: 'text', width: 410, render: (text: string) => <div className="question-text">{text}</div> },
        { title: '回答', width: 125, render: (_, row) => <Select aria-label={`第${row.number}题回答`} value={row.answer} disabled={disabled} style={{ width: '100%' }} options={[{ value: '', label: '未回答' }, { value: 'Y', label: '是' }, { value: 'N', label: '否' }]} onChange={(answer: QuestionAnswer) => update(row.number, { answer })} /> },
        { title: '备注', render: (_, row) => <><Input.TextArea aria-label={`第${row.number}题备注`} value={row.remark} disabled={disabled} autoSize={{ minRows: 2, maxRows: 8 }} onChange={(event) => update(row.number, { remark: event.target.value })} />{row.remark_hint && row.answer === row.remark_hint.answer && !row.remark.trim() && <p className="question-hint" role="status">{row.remark_hint.text}</p>}</> },
      ]} />
    </section>)}
    {save.error && <Alert type="error" showIcon title="保存失败，填写内容仍保留" description={save.error.message} className="form-alert" />}
    <div className="form-footer"><div><span className={dirty ? 'save-status unsaved' : 'save-status'}>{save.status}</span><p className="muted">最近保存：{new Date(data.updated_at).toLocaleString('zh-CN', { hour12: false })}</p></div><div className="form-actions"><Button disabled={busy} onClick={onPrevious}>上一页</Button><Button type="primary" loading={save.manual} disabled={locked || save.manual || leaving || !dirty} onClick={save.clickSave}>保存草稿</Button><Button disabled={busy} onClick={onNext}>下一页</Button></div></div>
  </div>
}

export default function QuestionEditor(props: Props) {
  const { record, leaving } = props
  const queryClient = useQueryClient()
  const actorId = actorUser(queryClient).id
  const queryKey = ['questions', actorId, record.id]
  const questions = useQuery({
    queryKey,
    queryFn: async () => {
      const result = await api<QuestionData>(`/api/changes/${record.id}/questions/`, 'GET', undefined, actorId)
      // A delayed read must not regress the cache after a newer save either.
      return newestResponse(queryClient.getQueryData<QuestionData>(queryKey), result)
    },
    refetchOnWindowFocus: false,
  })
  return <>
    {questions.error && <Alert type="error" showIcon title={questions.data ? '问题评估刷新失败，当前填写内容仍保留' : '无法读取问题评估'} description={questions.error.message} className="form-alert" action={<Button loading={questions.isFetching} disabled={leaving} onClick={() => void questions.refetch()}>重试</Button>} />}
    {questions.data ? <QuestionForm {...props} data={questions.data} /> : questions.isPending ? <Spin tip="正在读取问题评估…"><div className="loading-space" /></Spin> : <Button disabled={leaving} onClick={props.onBack}>{backLabel(queryClient)}</Button>}
  </>
}
