import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Drawer, Input, Select } from 'antd'
import { api, type ChangeRequest } from './api'
import { newestResponse, refreshBaseline } from './latestResponse'
import { saveResultUnconfirmed } from './questionDraft'
import { cellKey, emcPatch, testName, type Mark, type Cell, type EmcData, type EmcPatch } from './emcMatrix'
import { ReferenceTable, ReferenceNotes } from './EmcMatrixView'

const marks = [{ value: '', label: '空白：未指定' }, { value: 'X', label: 'X：需要测试' }, { value: '(X)', label: '(X)：需要分析' }]
type Props = {
  record: ChangeRequest; onDirty: (value: boolean) => void; onBusy: (value: boolean) => void
  onBack: () => void; onPrevious: () => void; leaving: boolean
  onReauthenticate: () => void; onEditorOpen: (value: boolean) => void
}

function EmcForm({ data, record, onDirty, onBusy, onBack, onPrevious, leaving, onReauthenticate, onEditorOpen }: Props & { data: EmcData }) {
  const queryClient = useQueryClient()
  const { message } = App.useApp()
  const [state, setState] = useState({ baseline: data, values: structuredClone(data) })
  const [unconfirmed, setUnconfirmed] = useState<EmcPatch>({ cells: {} })
  const [rowId, setRowId] = useState<string | null>(null)
  const patch = emcPatch(state.baseline, state.values, unconfirmed)
  const dirty = Object.keys(patch.cells).length > 0
  const row = state.values.rows.find((item) => item.id === rowId)
  const locked = record.status !== 'draft' || !data.can_fill
  const save = useMutation({
    mutationFn: (submitted: EmcPatch) => api<EmcData>(`/api/changes/${record.id}/emc/`, 'PATCH', submitted, record.applicant),
    onMutate: () => onBusy(true), onSettled: () => onBusy(false),
    onError: (error, submitted) => {
      if (saveResultUnconfirmed(error)) {
        setUnconfirmed((current) => {
          const cells = { ...current.cells }
          for (const [key, fields] of Object.entries(submitted.cells)) cells[key] = { ...cells[key], ...fields }
          return { cells }
        })
        onDirty(true)
      }
    },
    onSuccess: (result) => {
      const key = ['emc', record.applicant, record.id]
      const latest = newestResponse(queryClient.getQueryData<EmcData>(key), result)
      queryClient.setQueryData(key, latest)
      setState({ baseline: latest, values: structuredClone(latest) })
      setUnconfirmed({ cells: {} }); onDirty(false); setRowId(null)
      queryClient.setQueryData<ChangeRequest>(['change', record.applicant, record.id], (current) => current ? newestResponse(current, { ...current, updated_at: latest.updated_at }) : current)
      void queryClient.invalidateQueries({ queryKey: ['changes', record.applicant] })
      message.success('EMC 填写已保存')
    },
  })
  useEffect(() => { onEditorOpen(!!rowId); return () => onEditorOpen(false) }, [rowId, onEditorOpen])
  const refreshed = refreshBaseline(state.baseline, data, dirty || save.isPending)
  if (refreshed !== state.baseline) {
    setState({ baseline: refreshed, values: structuredClone(refreshed) })
  }
  const busy = save.isPending || leaving
  const close = () => {
    if (busy) return
    // Closing the drawer keeps its edits in the page draft.
    setRowId(null)
  }
  const updateCell = (testId: string, fields: Partial<Cell>) => {
    if (!rowId || locked || busy) return
    const key = cellKey(rowId, testId)
    const cells = { ...state.values.cells }
    const value = { ...(cells[key] ?? { mark: '' as Mark, remark: '' }), ...fields }
    if (value.mark || value.remark) cells[key] = value
    else delete cells[key]
    const values = { ...state.values, cells }
    setState({ ...state, values }); onDirty(Object.keys(emcPatch(state.baseline, values, unconfirmed).cells).length > 0)
  }
  const saveButton = <Button type="primary" disabled={locked || busy || !dirty} loading={save.isPending} onClick={() => save.mutate(patch)}>保存 EMC 填写</Button>
  const status = Object.keys(unconfirmed.cells).length ? '上次保存结果未确认，请重试' : dirty ? '有未保存的修改' : '与已保存内容一致'
  return <>
    <div className="page-heading"><div><span className="eyebrow">申请 #{record.id}</span><h1>EMC 参考与填写</h1><p className="muted">填写测试标记与说明。典型变更、表头与测试列为只读参考，维护功能另行接入。</p></div><Button disabled={busy} onClick={onBack}>返回我的申请</Button></div>
    {locked && <Alert type="info" title="申请已锁定，EMC 仅供查看。" className="form-alert" />}
    <section className="panel list-panel emc-section"><div className="section-heading"><h2>{state.values.title}</h2>{saveButton}</div>
      <ReferenceNotes matrix={state.values} /><ReferenceTable matrix={state.values} editLabel={locked ? '查看' : '填写'} edit={busy || rowId ? undefined : setRowId} />
      <p className="muted">X：需要测试；(X)：需要分析后判断；—：空白未指定。填写不自动代替实际测试结论。</p>
      {save.error && <Alert type="error" title="保存失败，填写内容仍保留" description={save.error.message} className="form-alert" />}
      <div className="form-footer"><span className={dirty ? 'save-status unsaved' : 'save-status'}>{status}</span><div className="form-actions"><Button disabled={busy || !!rowId} onClick={onPrevious}>上一页</Button>{saveButton}</div></div>
    </section>
    <Drawer open={!!row} size={760} title={locked ? '查看 EMC 填写' : '填写 EMC 测试标记与说明'} onClose={close} closable={!busy} maskClosable={!busy} keyboard={!busy}
      extra={<Button disabled={busy} onClick={onReauthenticate}>重新登录</Button>} footer={<div className="form-footer"><span className={dirty ? 'save-status unsaved' : 'save-status'}>{status}</span>{saveButton}</div>}>
      {row && <div className="preview-drawer"><label>典型变更</label><p className="question-text">{row.label}</p>
        {state.values.tests.map((test) => { const value = state.values.cells[cellKey(row.id, test.id)] ?? { mark: '' as Mark, remark: '' }; return <section className="emc-test-edit" key={test.id}>
          <div className="question-text"><strong>{test.label}</strong><div className="muted">{test.group} · {test.standard}</div></div>
          <Select id={`${test.id}-mark`} aria-label={`${testName(test.label)} 标记`} disabled={locked || busy} value={value.mark} options={marks} style={{ width: 190 }} onChange={(mark: Mark) => updateCell(test.id, { mark })} />
          <Input.TextArea id={`${test.id}-remark`} aria-label={`${testName(test.label)} 说明`} disabled={locked || busy} value={value.remark} autoSize={{ minRows: 1, maxRows: 5 }} placeholder="该测试格的说明或分析理由" onChange={(event) => updateCell(test.id, { remark: event.target.value })} />
        </section> })}
        {save.error && <Alert type="error" title="保存失败，填写内容仍保留" description={save.error.message} />}
      </div>}
    </Drawer>
  </>
}

export default function EmcEditor(props: Props) {
  const { record, leaving } = props
  const queryClient = useQueryClient()
  const queryKey = ['emc', record.applicant, record.id]
  const query = useQuery({ queryKey, refetchOnWindowFocus: false, queryFn: async () => {
    const result = await api<EmcData>(`/api/changes/${record.id}/emc/`, 'GET', undefined, record.applicant)
    return newestResponse(queryClient.getQueryData<EmcData>(queryKey), result)
  } })
  return <>{query.error && <Alert type="error" title={query.data ? 'EMC 刷新失败，当前填写仍保留' : '无法读取 EMC'} description={query.error.message} className="form-alert" action={<Button disabled={leaving} loading={query.isFetching} onClick={() => void query.refetch()}>重试</Button>} />}
    {query.data ? <EmcForm {...props} data={query.data} /> : query.isPending ? <p>正在读取 EMC…</p> : <Button onClick={props.onBack}>返回我的申请</Button>}
  </>
}
