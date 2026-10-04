import { actorUser, canEdit, backLabel } from './workflow'
import { useEffect, useImperativeHandle, useState, type Ref } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Drawer, Input, Select } from 'antd'
import { api, type ChangeRequest } from './api'
import { newestResponse } from './latestResponse'
import useAutosave from './useAutosave'
import type { SaveHandle } from './SaveBeforeSwitch'
import { emcFields, emcPayload } from './autosaveFields'
import { cellKey, testName, type Mark, type Cell, type EmcData } from './emcMatrix'
import { ReferenceTable, ReferenceNotes } from './EmcMatrixView'

const marks = [{ value: '', label: '空白：未指定' }, { value: 'X', label: 'X：需要测试' }, { value: '(X)', label: '(X)：需要分析' }]
type Props = {
  record: ChangeRequest; onDirty: (value: boolean) => void; onBusy: (value: boolean) => void
  onBack: () => void; onPrevious: () => void; onNext: () => void; leaving: boolean
  onReauthenticate: () => void; onEditorOpen: (value: boolean) => void
  paused?: boolean; saveRef?: Ref<SaveHandle>
}

function EmcForm({ data, record, onDirty, onBusy, onBack, onPrevious, onNext, leaving, onReauthenticate, onEditorOpen, paused, saveRef }: Props & { data: EmcData }) {
  const queryClient = useQueryClient()
  const actorId = actorUser(queryClient).id
  const { message } = App.useApp()
  const [rowId, setRowId] = useState<string | null>(null)
  const row = data.rows.find((item) => item.id === rowId)
  const locked = !canEdit(record, actorUser(queryClient).role) || !data.can_fill
  const save = useAutosave({
    fields: emcFields(data), enabled: !locked && !leaving, paused, onDirty, onBusy,
    send: async (patch) => {
      const result = await api<EmcData>(`/api/changes/${record.id}/emc/`, 'PATCH', emcPayload(patch), actorId)
      const key = ['emc', actorId, record.id]
      const latest = newestResponse(queryClient.getQueryData<EmcData>(key), result)
      if (save.queue.active) {
        queryClient.setQueryData(key, latest)
        void queryClient.invalidateQueries({ queryKey: ['change', actorId, record.id] })
        void queryClient.invalidateQueries({ queryKey: ['changes', actorId] })
      }
      return emcFields(latest)
    },
  })
  const matrix = { ...data, cells: Object.fromEntries(Object.entries(emcPayload(save.values).cells).map(([key, cell]) => [key, { mark: cell.mark ?? '', remark: cell.remark ?? '' }])) }
  useImperativeHandle(saveRef, () => ({ save: save.manualSave }))
  const dirty = save.dirty
  useEffect(() => { onEditorOpen(!!rowId); return () => onEditorOpen(false) }, [rowId, onEditorOpen])
  const busy = save.pending || save.manual || leaving
  const close = () => { if (!busy) setRowId(null) }
  const updateCell = (testId: string, fields: Partial<Cell>) => {
    if (!rowId || locked || save.manual || leaving) return
    const key = cellKey(rowId, testId)
    save.update(Object.fromEntries(Object.entries(fields).map(([field, value]) => [`${key}.${field}`, value])))
  }
  const manualSave = () => { void save.manualSave().then(() => { setRowId(null); message.success('EMC 填写已保存') }).catch(() => {}) }
  const saveButton = <Button type="primary" disabled={locked || save.manual || leaving || !dirty} loading={save.manual} onClick={manualSave}>保存 EMC 填写</Button>
  const status = save.status
  return <>
    <div className="page-heading"><div><span className="eyebrow">申请 #{record.id}</span><h1>EMC 参考与填写</h1><p className="muted">填写测试标记与说明。典型变更、表头与测试列为只读参考，维护功能另行接入。</p></div><Button disabled={busy} onClick={onBack}>{backLabel(queryClient)}</Button></div>
    {locked && <Alert type="info" title="申请已锁定，EMC 仅供查看。" className="form-alert" />}
    <section className="panel list-panel emc-section"><div className="section-heading"><h2>{matrix.title}</h2>{saveButton}</div>
      <ReferenceNotes matrix={matrix} /><ReferenceTable matrix={matrix} editLabel={locked ? '查看' : '填写'} edit={busy || rowId ? undefined : setRowId} />
      <p className="muted">X：需要测试；(X)：需要分析后判断；—：空白未指定。填写不自动代替实际测试结论。</p>
      {save.error && <Alert type="error" title="保存失败，填写内容仍保留" description={save.error.message} className="form-alert" />}
      <div className="form-footer"><span className={dirty ? 'save-status unsaved' : 'save-status'}>{status}</span><div className="form-actions"><Button disabled={busy || !!rowId} onClick={onPrevious}>上一页</Button>{saveButton}<Button disabled={busy || !!rowId} onClick={onNext}>下一页</Button></div></div>
    </section>
    <Drawer open={!!row} size={760} title={locked ? '查看 EMC 填写' : '填写 EMC 测试标记与说明'} onClose={close} closable={!busy} maskClosable={!busy} keyboard={!busy}
      extra={<Button disabled={busy} onClick={onReauthenticate}>重新登录</Button>} footer={<div className="form-footer"><span className={dirty ? 'save-status unsaved' : 'save-status'}>{status}</span>{saveButton}</div>}>
      {row && <div className="preview-drawer" {...save.composition}><label>典型变更</label><p className="question-text">{row.label}</p>
        {matrix.tests.map((test) => { const value = matrix.cells[cellKey(row.id, test.id)] ?? { mark: '' as Mark, remark: '' }; return <section className="emc-test-edit" key={test.id}>
          <div className="question-text"><strong>{test.label}</strong><div className="muted">{test.group} · {test.standard}</div></div>
          <Select id={`${test.id}-mark`} aria-label={`${testName(test.label)} 标记`} disabled={locked || save.manual || leaving} value={value.mark} options={marks} style={{ width: 190 }} onChange={(mark: Mark) => updateCell(test.id, { mark })} />
          <Input.TextArea id={`${test.id}-remark`} aria-label={`${testName(test.label)} 说明`} disabled={locked || save.manual || leaving} value={value.remark} autoSize={{ minRows: 1, maxRows: 5 }} placeholder="该测试格的说明或分析理由" onChange={(event) => updateCell(test.id, { remark: event.target.value })} />
        </section> })}
        {save.error && <Alert type="error" title="保存失败，填写内容仍保留" description={save.error.message} />}
      </div>}
    </Drawer>
  </>
}

export default function EmcEditor(props: Props) {
  const { record, leaving } = props
  const queryClient = useQueryClient()
  const actorId = actorUser(queryClient).id
  const queryKey = ['emc', actorId, record.id]
  const query = useQuery({ queryKey, refetchOnWindowFocus: false, queryFn: async () => {
    const result = await api<EmcData>(`/api/changes/${record.id}/emc/`, 'GET', undefined, actorId)
    return newestResponse(queryClient.getQueryData<EmcData>(queryKey), result)
  } })
  return <>{query.error && <Alert type="error" title={query.data ? 'EMC 刷新失败，当前填写仍保留' : '无法读取 EMC'} description={query.error.message} className="form-alert" action={<Button disabled={leaving} loading={query.isFetching} onClick={() => void query.refetch()}>重试</Button>} />}
    {query.data ? <EmcForm {...props} data={query.data} /> : query.isPending ? <p>正在读取 EMC…</p> : <Button onClick={props.onBack}>{backLabel(queryClient)}</Button>}
  </>
}
