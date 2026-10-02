import { useImperativeHandle, useState, type Ref } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Input, Select, Spin, Table } from 'antd'
import { api, type ChangeRequest, type Question, type QuestionAnswer, type QuestionData } from './api'
import { questionPatch, saveResultUnconfirmed, type QuestionPatch } from './questionDraft'
import type { SaveHandle } from './SaveBeforeSwitch'

type Props = {
  record: ChangeRequest; onDirty: (value: boolean) => void; onBusy: (value: boolean) => void
  onBack: () => void; onPrevious: () => void; leaving: boolean
  onNext: () => void
  saveRef?: Ref<SaveHandle>
}

function QuestionForm({ data, record, onDirty, onBusy, onBack, onPrevious, onNext, saveRef, leaving }: Props & { data: QuestionData }) {
  const [state, setState] = useState({ baseline: data, values: data, seen: data })
  const [unconfirmed, setUnconfirmed] = useState<QuestionPatch>({})
  const queryClient = useQueryClient()
  const { message } = App.useApp()
  const responses = questionPatch(state.baseline, state.values, unconfirmed)
  const dirty = Object.keys(responses).length > 0
  const locked = record.status !== 'draft'
  const save = useMutation({
    mutationFn: (submitted: QuestionPatch) => api<QuestionData>(`/api/changes/${record.id}/questions/`, 'PATCH', { responses: submitted }, record.applicant),
    onMutate: () => onBusy(true),
    onSettled: () => onBusy(false),
    onError: (error, submitted) => {
      if (saveResultUnconfirmed(error)) {
        setUnconfirmed((current) => {
          const combined = { ...current }
          for (const [number, fields] of Object.entries(submitted)) combined[number] = { ...combined[number], ...fields }
          return combined
        })
        onDirty(true)
      }
      message.error('保存失败，填写内容仍保留')
    },
    onSuccess: (result) => {
      setState({ baseline: result, values: result, seen: result })
      setUnconfirmed({})
      onDirty(false)
      queryClient.setQueryData(['questions', record.applicant, record.id], result)
      void queryClient.invalidateQueries({ queryKey: ['ecr-actions', record.applicant, record.id] })
      queryClient.setQueryData<ChangeRequest>(['change', record.applicant, record.id], (current) => current ? { ...current, updated_at: result.updated_at } : current)
      void queryClient.invalidateQueries({ queryKey: ['changes', record.applicant] })
      message.success('问题评估草稿已保存')
    },
  })
  useImperativeHandle(saveRef, () => ({ save: async () => {
    if (locked || save.isPending || leaving) throw new Error('当前不能保存')
    if (dirty) await save.mutateAsync(responses)
  } }))
  // Observe each fetched result once. A dirty draft keeps both its values and baseline.
  if (data !== state.seen) {
    const older = new Date(data.updated_at).getTime() < new Date(state.baseline.updated_at).getTime()
    setState(dirty || save.isPending || older ? { ...state, seen: data } : { baseline: data, values: data, seen: data })
  }
  const busy = save.isPending || leaving
  const update = (number: number, fields: Partial<Pick<Question, 'answer' | 'remark'>>) => {
    const values = { ...state.values, questions: state.values.questions.map((row) => row.number === number ? { ...row, ...fields } : row) }
    setState({ ...state, values })
    onDirty(Object.keys(questionPatch(state.baseline, values, unconfirmed)).length > 0)
  }
  const groups = [...new Set(state.values.questions.map((row) => row.function))]
  return <>
    <div className="page-heading"><div><span className="eyebrow">申请 #{record.id}</span><h1>问题评估</h1><p className="muted">未回答与否分别保存；缺少条件性理由时会提示，仍可保存草稿。</p></div><div className="form-actions"><Button type="primary" loading={save.isPending} disabled={locked || busy || !dirty} onClick={() => save.mutate(responses)}>保存草稿</Button><Button disabled={busy} onClick={onBack}>返回我的申请</Button></div></div>
    {locked && <Alert type="info" title="申请已锁定，问题评估仅供查看。" className="form-alert" />}
    {groups.map((group) => <section className="panel list-panel question-section" key={group}>
      <div className="section-heading"><h2>{group}</h2></div>
      <Table<Question> rowKey="number" pagination={false} scroll={{ x: 880 }} dataSource={state.values.questions.filter((row) => row.function === group)} columns={[
        { title: '题号', dataIndex: 'number', width: 65 },
        { title: '问题', dataIndex: 'text', width: 410, render: (text: string) => <div className="question-text">{text}</div> },
        { title: '回答', width: 125, render: (_, row) => <Select aria-label={`第${row.number}题回答`} value={row.answer} disabled={locked || busy} style={{ width: '100%' }} options={[{ value: '', label: '未回答' }, { value: 'Y', label: '是' }, { value: 'N', label: '否' }]} onChange={(answer: QuestionAnswer) => update(row.number, { answer })} /> },
        { title: '备注', render: (_, row) => <><Input.TextArea aria-label={`第${row.number}题备注`} value={row.remark} disabled={locked || busy} autoSize={{ minRows: 2, maxRows: 8 }} onChange={(event) => update(row.number, { remark: event.target.value })} />{row.remark_hint && row.answer === row.remark_hint.answer && !row.remark.trim() && <p className="question-hint" role="status">{row.remark_hint.text}</p>}</> },
      ]} />
    </section>)}
    {save.error && <Alert type="error" showIcon title="保存失败，填写内容仍保留" description={save.error.message} className="form-alert" />}
    <div className="form-footer"><div><span className={dirty ? 'save-status unsaved' : 'save-status'}>{save.isPending ? '正在保存…' : Object.keys(unconfirmed).length ? '上次保存结果未确认，请重试' : dirty ? '有未保存的修改' : '已保存'}</span><p className="muted">最近保存：{new Date(state.baseline.updated_at).toLocaleString('zh-CN', { hour12: false })}</p></div><div className="form-actions"><Button disabled={busy} onClick={onPrevious}>上一页</Button><Button type="primary" loading={save.isPending} disabled={locked || busy || !dirty} onClick={() => save.mutate(responses)}>保存草稿</Button><Button disabled={busy} onClick={onNext}>下一页</Button></div></div>
  </>
}

export default function QuestionEditor(props: Props) {
  const { record, leaving } = props
  const queryClient = useQueryClient()
  const queryKey = ['questions', record.applicant, record.id]
  const questions = useQuery({
    queryKey,
    queryFn: async () => {
      const result = await api<QuestionData>(`/api/changes/${record.id}/questions/`, 'GET', undefined, record.applicant)
      const current = queryClient.getQueryData<QuestionData>(queryKey)
      // A delayed read must not regress the cache after a newer save either.
      return current && new Date(current.updated_at).getTime() > new Date(result.updated_at).getTime() ? current : result
    },
    refetchOnWindowFocus: false,
  })
  return <>
    {questions.error && <Alert type="error" showIcon title={questions.data ? '问题评估刷新失败，当前填写内容仍保留' : '无法读取问题评估'} description={questions.error.message} className="form-alert" action={<Button loading={questions.isFetching} disabled={leaving} onClick={() => void questions.refetch()}>重试</Button>} />}
    {questions.data ? <QuestionForm {...props} data={questions.data} /> : questions.isPending ? <Spin tip="正在读取问题评估…"><div className="loading-space" /></Spin> : <Button disabled={leaving} onClick={props.onBack}>返回我的申请</Button>}
  </>
}
