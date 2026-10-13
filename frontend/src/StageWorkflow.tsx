import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Checkbox, Drawer, Input, Select, Table, Tag } from 'antd'
import { api, ApiError, type ChangeRequest, type User } from './api'
import { actorUser, canEdit, backLabel } from './workflow'
import { newestResponse } from './latestResponse'
import { checkedReviewers } from './submission'
import { saveResultUnconfirmed } from './questionDraft'
import useAutosave from './useAutosave'
import DateInput from './DateInput'
import { checkedStage, saveTaskPatch, taskConfirmationState, stageSubmissionState, type TaskWriteState, type StageData, type StageAction, type StageTask, type TaskPayload, type StageSubmitPayload } from './ecrStage'

type Callbacks = { onDirty: (value: boolean) => void; onBusy: (value: boolean) => void }
function useStage(record: ChangeRequest) {
  const client = useQueryClient(), actor = actorUser(client).id
  const key = ['stage-workflow', actor, record.id]
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const accept = (value: unknown) => {
    const incoming = checkedStage(value, record.id, actor)
    if (!active.current || client.getQueryData<User>(['me'])?.id !== actor) throw new Error('当前账号或页面已变化。')
    const latest = newestResponse(client.getQueryData<StageData>(key), incoming)
    client.setQueryData(key, latest)
    if (latest.change) client.setQueryData<ChangeRequest>(['change', actor, record.id], current => newestResponse(current, latest.change!))
    for (const resource of ['changes', 'review-list', 'review-inbox', 'review-round', 'publication', 'publications', 'stage-navigation']) void client.invalidateQueries({ queryKey: [resource, actor] })
    return latest
  }
  const read = async () => accept(await api<unknown>(`/api/changes/${record.id}/stage-workflow/`, 'GET', undefined, actor))
  const query = useQuery({ queryKey: key, queryFn: async () => checkedStage(await api<unknown>(`/api/changes/${record.id}/stage-workflow/`, 'GET', undefined, actor), record.id, actor, client.getQueryData<StageData>(key)), refetchOnWindowFocus: false })
  return { actor, query, accept, read }
}

function Assignment({ record, action, leaving, accept, ...callbacks }: Callbacks & { record: ChangeRequest; action: StageAction; leaving: boolean; accept: (value: unknown) => StageData }) {
  const client = useQueryClient(), actor = actorUser(client).id
  const editable = canEdit(record, actorUser(client)) && !leaving
  const people = useQuery({ queryKey: ['action-owners', actor], enabled: editable, queryFn: async () => checkedReviewers(await api<unknown>('/api/action-owners/', 'GET', undefined, actor)) })
  const save = useAutosave({ ...callbacks, fields: { owner_user_ids: JSON.stringify(action.owner_user_ids ?? (action.owner_user_id ? [action.owner_user_id] : [])), extra_required: action.extra_required ? 'Y' : 'N' }, enabled: editable,
    send: async patch => {
      await api(`/api/changes/${record.id}/${record.stage}-actions/${action.id}/`, 'PATCH', {
        ...('owner_user_ids' in patch ? { owner_user_ids: JSON.parse(String(patch.owner_user_ids)) } : {}),
        ...('extra_required' in patch ? { extra_required: patch.extra_required === 'Y' } : {}),
      }, actor)
      const data = accept(await api<unknown>(`/api/changes/${record.id}/stage-workflow/`, 'GET', undefined, actor))
      const latest = data.actions.find(row => row.id === action.id)!
      return { owner_user_ids: JSON.stringify(latest.owner_user_ids ?? []), extra_required: latest.extra_required ? 'Y' : 'N' }
    } })
  const options = (people.data ?? []).map(person => ({ value: String(person.id), label: `${person.display_name}（${person.username}）` }))
  for (const owner of action.owner_users ?? []) if (!options.some(option => option.value === String(owner.id))) options.push({ value: String(owner.id), label: `${owner.display_name}${owner.is_active ? '' : ' · 已停用'}` })
  return <>
    <p className="question-text">{action.text}</p>
    <label>行动负责人</label><Select mode="multiple" aria-label="行动负责人" style={{ width: '100%' }} options={options} value={(JSON.parse(String(save.values.owner_user_ids)) as number[]).map(String)} showSearch optionFilterProp="label" allowClear disabled={!editable || save.manual} onChange={value => save.update({ owner_user_ids: JSON.stringify(value.map(Number).sort((a: number, b: number) => a - b)) })} />
    <p><Checkbox checked={save.values.extra_required === 'Y'} disabled={!editable || save.manual || action.question_answer === 'Y'} onChange={event => save.update({ extra_required: event.target.checked ? 'Y' : 'N' })}>补充为本轮必须处理的行动</Checkbox></p>
    <p className="muted">问题触发的行动自动纳入；结果、状态和日期由负责人提交后填写。</p>
    {people.error && <Alert type="error" title={people.error.message} />}
    {save.error && <Alert type="error" title={save.error.message} />}
    <div className="form-footer"><span>{save.status}</span><Button disabled={!editable || !save.dirty} loading={save.manual} onClick={save.clickSave}>保存分配</Button></div>
  </>
}

function TaskEditor({ record, task, leaving, accept, read, onReauthenticate, ...callbacks }: Callbacks & { record: ChangeRequest; task: StageTask; leaving: boolean; accept: (value: unknown) => StageData; read: () => Promise<StageData>; onReauthenticate: () => void }) {
  const client = useQueryClient(), actor = actorUser(client).id, { modal } = App.useApp()
  const writes = useRef<TaskWriteState>({ task, pending: null })
  const [unknown, setUnknown] = useState<TaskPayload | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [dateInvalid, setDateInvalid] = useState(false)
  const [saveBusy, setSaveBusy] = useState(false), [saveDirty, setSaveDirty] = useState(false)
  const save = useAutosave({ fields: { result: task.result, status: task.status, date: task.date }, enabled: task.can_edit && !leaving && !unknown, paused: busy, valid: !dateInvalid, onBusy: setSaveBusy, onDirty: setSaveDirty,
    send: patch => saveTaskPatch(writes.current, patch, async payload => {
        const data = accept(await api<unknown>(`/api/changes/${record.id}/action-tasks/${task.id}/`, 'PATCH', payload, actor))
        return data.tasks.find(row => row.id === task.id)!
    }) })
  useEffect(() => { callbacks.onBusy(saveBusy || busy || !!unknown); callbacks.onDirty(saveDirty || !!unknown) }, [callbacks, saveBusy, saveDirty, busy, unknown])
  useEffect(() => { if (!save.dirty && !save.pending && !writes.current.pending) writes.current.task = task }, [task, save.dirty, save.pending])
  const settleConfirmation = (data: StageData, payload: TaskPayload) => {
    const latest = data.tasks.find(row => row.id === task.id)
    const state = taskConfirmationState(latest, payload)
    if (latest) writes.current.task = latest
    if (state === 'confirmed') { setUnknown(null); setError('') }
    else if (state === 'ended') { setUnknown(null); setError('任务状态、轮次或版本已变化，原确认不能继续；未发送输入仍保留，请核对记录。') }
    else { setUnknown(payload); setError('尚未确认原请求，请查询或按原请求重试。') }
  }
  const runConfirm = async (payload: TaskPayload) => {
    setBusy(true); setError('')
    try {
      const data = accept(await api<unknown>(`/api/changes/${record.id}/action-tasks/${task.id}/`, 'POST', payload, actor))
      settleConfirmation(data, payload)
    } catch (failure) {
      if (saveResultUnconfirmed(failure)) { setUnknown(payload); setError(failure instanceof Error ? failure.message : String(failure)) }
      else {
        try {
          const data = await read()
          if (taskConfirmationState(data.tasks.find(row => row.id === task.id), payload) === 'retryable') { setUnknown(null); setError(failure instanceof Error ? failure.message : String(failure)) }
          else settleConfirmation(data, payload)
        } catch {
          if (failure instanceof ApiError && [400, 404, 409].includes(failure.status)) setUnknown(null)
          setError(failure instanceof Error ? failure.message : String(failure))
        }
      }
    }
    finally { setBusy(false) }
  }
  const confirm = () => modal.confirm({ title: '确认本行动？', content: '先保存当前填写，再确认任务。确认后本轮该行动只读；这不是阶段发布。', onOk: async () => {
    setBusy(true)
    try { await save.manualSave(); await runConfirm({ version: writes.current.task.version, request_id: crypto.randomUUID() }) }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); setBusy(false) }
  } })
  const check = async () => {
    setBusy(true)
    try { const data = await read(); if (unknown) settleConfirmation(data, unknown) }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) } finally { setBusy(false) }
  }
  const disabled = !task.can_edit || leaving || busy || !!unknown || save.manual
  return <>
    <p>第{task.round}轮 · 负责人：{task.owner_name} · {task.confirmed_at ? '已确认' : '待处理'}</p>
    {task.round > 1 && !task.confirmed_at && <Alert type="info" title="旧轮结果仅作为待复核初值，本轮仍须重新确认。" />}
    <label>评估结果／不适用原因</label><Input.TextArea aria-label="任务评估结果" disabled={disabled} value={String(save.values.result)} autoSize={{ minRows: 4 }} onChange={event => save.update({ result: event.target.value })} />
    <label>业务状态</label><Select aria-label="任务业务状态" style={{ width: '100%' }} disabled={disabled} value={save.values.status} options={[{ value: '', label: '未填写' }, { value: 'completed', label: '完成' }, { value: 'not_applicable', label: '不适用' }, ...(record.stage === 'eco' ? [{ value: 'implementation_stage', label: '在实施阶段完成' }] : [])]} onChange={value => save.update({ status: value })} />
    <label>业务日期</label><DateInput id="task-date" disabled={disabled} value={String(save.values.date ?? '')} onChange={event => { const invalid = !event.target.validity.valid; setDateInvalid(invalid); if (!invalid) save.update({ date: event.target.value || null }) }} />
    {save.values.status === 'implementation_stage' && <Alert type="info" title="在实施阶段完成可保存；改为完成或不适用且说明、日期完整后才能确认。" />}
    {(error || save.error) && <Alert type="error" title={error || save.error?.message} />}
    {unknown && <Alert type="warning" title="确认结果未确认，原请求已保留" action={<><Button disabled={busy || leaving} onClick={() => void check()}>查询结果</Button><Button disabled={busy || leaving} onClick={() => void runConfirm(unknown)}>按原请求重试</Button><Button disabled={busy || leaving} onClick={onReauthenticate}>重新登录</Button></>} />}
    <div className="form-footer"><span>{save.status}</span><Button disabled={disabled || !save.dirty} onClick={save.clickSave}>保存结果</Button><Button type="primary" disabled={disabled || save.pending || dateInvalid || !String(save.values.result).trim() || !save.values.status || save.values.status === 'implementation_stage' || !save.values.date} onClick={confirm}>确认任务</Button></div>
  </>
}

export function StageActions({ record, leaving, onBack, onPrevious, onNext, onEditorOpen, onReauthenticate, ...callbacks }: Callbacks & { record: ChangeRequest; leaving: boolean; onBack: () => void; onPrevious: () => void; onNext: () => void; onEditorOpen: (value: boolean) => void; onReauthenticate: () => void }) {
  const { actor, query, accept, read } = useStage(record), client = useQueryClient(), { modal } = App.useApp()
  const [selected, setSelected] = useState<string | null>(null), [all, setAll] = useState(false), [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false)
  const callbackRef = useRef(callbacks)
  useEffect(() => { callbackRef.current = callbacks }, [callbacks])
  useEffect(() => () => { callbackRef.current.onBusy(false); callbackRef.current.onDirty(false) }, [])
  const data = query.data, currentRecord = data?.change ?? record
  const editingAssignment = canEdit(currentRecord, actorUser(client))
  const assignmentPhase = ['draft', 'returned'].includes(currentRecord.status)
  const tasks = data?.tasks.filter(task => task.round === data.current_round) ?? []
  useEffect(() => { onEditorOpen(!!selected); return () => onEditorOpen(false) }, [selected, onEditorOpen])
  const close = () => { if (busy || leaving) return; const finish = () => { setSelected(null); setDirty(false); callbacks.onDirty(false) }; if (dirty) modal.confirm({ title: '放弃未保存的输入？', content: '已保存内容不会撤销。', onOk: finish }); else finish() }
  const action = data?.actions.find(row => row.id === selected), task = tasks.find(row => row.action_key === selected && row.owner_id === actor) ?? tasks.find(row => row.action_key === selected)
  return <>
    <div className="page-heading"><h1>{record.stage?.toUpperCase()}行动分配与处理</h1><Button disabled={busy || leaving} onClick={onBack}>{backLabel(client)}</Button></div>
    <Alert type="info" title={assignmentPhase ? editingAssignment ? '草稿／修订时仅分配负责人和补充任务；结果由提交后的负责人填写。' : '当前ECO由指定填写人编辑，此处只读查看行动分配。' : `第${data?.current_round ?? record.current_review_round}轮：已确认 ${tasks.filter(task => task.confirmed_at).length}/${tasks.length} 项；基础内容锁定。`} className="form-alert" />
    {query.error && <Alert type="error" title={query.error.message} action={<Button onClick={() => void query.refetch()}>重试</Button>} />}
    <Select aria-label="行动范围" disabled={!!selected} value={all ? 'all' : 'required'} options={[{ value: 'required', label: '本轮行动' }, { value: 'all', label: '全部行动' }]} onChange={value => setAll(value === 'all')} />
    <Table rowKey="id" pagination={false} loading={query.isPending} dataSource={(data?.actions ?? []).filter(row => all || (assignmentPhase ? row.required : tasks.some(task => task.action_key === row.id)))} columns={[
      { title: '行动', render: (_, row) => <><Tag>{row.id} · 问题{row.number}</Tag><p>{row.text}</p></> },
      { title: '负责人', render: (_, row) => (assignmentPhase ? row.owner_name : tasks.filter(task => task.action_key === row.id).map(task => task.owner_name).join('、') || row.owner_name) || '未分配' },
      { title: '状态', render: (_, row) => { const assigned = assignmentPhase ? [] : tasks.filter(task => task.action_key === row.id); return assigned.length ? `已确认 ${assigned.filter(task => task.confirmed_at).length}/${assigned.length} 人` : row.extra_required ? '手工补充' : row.required ? '问题触发' : '不纳入' } },
      { title: '操作', render: (_, row) => <Button disabled={!!selected || busy || leaving} onClick={() => setSelected(row.id)}>{assignmentPhase ? editingAssignment ? '分配' : '查看分配' : tasks.some(task => task.action_key === row.id && task.can_edit && task.owner_id === actor) ? '处理任务' : '查看'}</Button> },
    ]} />
    <div className="form-footer"><Button disabled={!!selected || busy || leaving} onClick={onPrevious}>上一页</Button><Button disabled={!!selected || busy || leaving} onClick={onNext}>下一页</Button></div>
    <Drawer open={!!selected} title={action?.text ?? `${record.stage?.toUpperCase()}行动`} size={720} onClose={close} closable={!busy && !leaving} maskClosable={!busy && !leaving} keyboard={!busy && !leaving}>
      {action && (assignmentPhase ? <Assignment key={action.id} record={currentRecord} action={action} leaving={leaving} accept={accept} onDirty={value => { setDirty(value); callbacks.onDirty(value) }} onBusy={value => { setBusy(value); callbacks.onBusy(value) }} /> : task ? <><p>本行动负责人：{tasks.filter(row => row.action_key === selected).map(row => `${row.owner_name}（${row.confirmed_at ? '已确认' : '待处理'}）`).join('、')}</p><TaskEditor key={task.id} record={currentRecord} task={task} leaving={leaving} onReauthenticate={onReauthenticate} accept={accept} read={read} onDirty={value => { setDirty(value); callbacks.onDirty(value) }} onBusy={value => { setBusy(value); callbacks.onBusy(value) }} /></> : <p>本行动没有在当前轮次派发。</p>)}
    </Drawer>
  </>
}

export function StageSubmission({ record, leaving, onBack, onPrevious, reviewDraftDirty = false, ...callbacks }: Callbacks & { record: ChangeRequest; leaving: boolean; onBack: () => void; onPrevious: () => void; reviewDraftDirty?: boolean }) {
  const { actor, query, accept, read } = useStage(record), { modal } = App.useApp(), client = useQueryClient()
  const [acknowledge, setAcknowledge] = useState(false), [unknown, setUnknown] = useState<StageSubmitPayload | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const current = query.data?.change ?? record, editable = canEdit(current, actorUser(client))
  const people = useQuery({ queryKey: ['action-owners', actor], enabled: editable, queryFn: async () => checkedReviewers(await api<unknown>('/api/action-owners/', 'GET', undefined, actor)) })
  const publisher = useAutosave({ fields: { publisher_id: current.publisher_id == null ? null : String(current.publisher_id), stage_approver_ids: JSON.stringify(current.stage_approver_ids ?? []) }, enabled: editable && !leaving && !unknown, paused: busy,
    onDirty: value => callbacks.onDirty(value || !!unknown), onBusy: value => callbacks.onBusy(value || busy || !!unknown),
    send: async patch => { await api(`/api/changes/${record.id}/`, 'PATCH', { ...('publisher_id' in patch ? { publisher_id: patch.publisher_id === null ? null : Number(patch.publisher_id) } : {}), ...('stage_approver_ids' in patch ? { stage_approver_ids: JSON.parse(String(patch.stage_approver_ids)) } : {}) }, actor); const data = await read(); return { publisher_id: data.change?.publisher_id == null ? null : String(data.change.publisher_id), stage_approver_ids: JSON.stringify(data.change?.stage_approver_ids ?? []) } } })
  const required = query.data?.actions.filter(action => action.required) ?? []
  const blocked = !query.data || query.data.unanswered.length > 0 || required.some(action => !action.owner_active) || !current.publisher_id || !JSON.parse(String(publisher.values.stage_approver_ids)).length || query.data.issue_blockers.length > 0 || reviewDraftDirty || (!required.length && !acknowledge)
  const settleSubmission = (data: StageData, payload: StageSubmitPayload, rejected = false) => {
    const state = stageSubmissionState(data, payload)
    if (state === 'confirmed') { setUnknown(null); setError('') }
    else if (state === 'ended') { setUnknown(null); setError('阶段或轮次已变化，原请求不再重试；请核对当前记录。') }
    else if (rejected) setUnknown(null)
    else { setUnknown(payload); setError('原提交尚未确认，请查询或按原请求重试。') }
  }
  const send = async (payload: StageSubmitPayload) => {
    setBusy(true); setError('')
    try { settleSubmission(accept(await api<unknown>(`/api/changes/${record.id}/stage-submission/`, 'POST', payload, actor)), payload) }
    catch (failure) {
      if (saveResultUnconfirmed(failure) || failure instanceof ApiError && [401, 403].includes(failure.status)) setUnknown(payload)
      else {
        try { settleSubmission(await read(), payload, true) }
        catch { if (!unknown) setUnknown(null) }
      }
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally { setBusy(false) }
  }
  const check = async () => {
    setBusy(true)
    try { const data = await read(); if (unknown) settleSubmission(data, unknown) }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) } finally { setBusy(false) }
  }
  useEffect(() => { callbacks.onBusy(busy || !!unknown || publisher.pending); callbacks.onDirty(!!unknown || publisher.dirty) }, [callbacks, busy, unknown, publisher.pending, publisher.dirty])
  return <>
    <div className="page-heading"><h1>提交{record.stage?.toUpperCase()}行动任务</h1><Button disabled={busy || !!unknown || leaving || publisher.pending} onClick={onBack}>返回我的申请</Button></div>
    {query.error && <Alert type="error" title={query.error.message} action={<Button onClick={() => void query.refetch()}>重试</Button>} />}
    <p>已回答 {27 - (query.data?.unanswered.length ?? 27)}/27 题；本轮 {required.length} 项行动。</p>
    {editable ? <>
      <label>指定发布人（阶段批准后执行发布）</label><Select aria-label="指定发布人" style={{ width: '100%' }} disabled={busy || !!unknown || leaving} allowClear showSearch optionFilterProp="label" value={publisher.values.publisher_id ?? undefined} options={(people.data ?? []).map(person => ({ value: String(person.id), label: `${person.display_name}（${person.username}）` }))} onChange={value => publisher.update({ publisher_id: value ?? null })} />
      <label>指定批准人（全部人员同意后才能发布）</label><Select mode="multiple" aria-label="指定批准人" style={{ width: '100%' }} disabled={busy || !!unknown || leaving} allowClear showSearch optionFilterProp="label" value={(JSON.parse(String(publisher.values.stage_approver_ids)) as number[]).map(String)} options={(people.data ?? []).map(person => ({ value: String(person.id), label: `${person.display_name}（${person.username}）` }))} onChange={value => publisher.update({ stage_approver_ids: JSON.stringify(value.map(Number).sort((a: number, b: number) => a - b)) })} />
      {people.error && <Alert type="error" title="人员名单读取失败" description={people.error.message} action={<Button onClick={() => void people.refetch()}>重试</Button>} />}
      {!JSON.parse(String(publisher.values.stage_approver_ids)).length && <Alert type="warning" title="请至少选择一位批准人；可以选择多人，全部同意后才能发布。" />}
      <p>{publisher.status}</p>{publisher.error && <Alert type="error" title={publisher.error.message} action={<Button onClick={publisher.clickSave}>重试保存发布人</Button>} />}
      {required.some(action => !action.owner_active) && <Alert type="warning" title="本轮行动仍有未分配或停用负责人，请返回当前阶段行动页调整。" />}
      {!!query.data?.unanswered.length && <Alert type="warning" title={`未回答问题：${query.data.unanswered.join('、')}`} />}
      {!!query.data?.issue_blockers.length && <Alert type="warning" title={query.data.issue_blockers.join(' ')} />}
      {!required.length && <Checkbox disabled={busy || !!unknown} checked={acknowledge} onChange={event => setAcknowledge(event.target.checked)}>确认本阶段无行动需处理，提交后仍须全部指定批准人同意</Checkbox>}
      <p className="muted">提交后冻结行动、负责人和批准人；每位负责人独立填写并确认任务，正式意见解决后，还须全部指定批准人同意才能发布。</p>
      <Button type="primary" disabled={blocked || busy || !!unknown || leaving || publisher.dirty || publisher.pending} onClick={() => modal.confirm({ title: `提交本轮${record.stage?.toUpperCase()}任务？`, content: '基础内容将锁定，每位负责人确认各自任务后，全部指定批准人需同意批准。', onOk: () => send({ expected_round: current.current_review_round, request_id: crypto.randomUUID(), acknowledge_no_tasks: acknowledge }) })}>提交阶段</Button>
    </> : <Alert type={['approved', 'published'].includes(current.status) ? 'success' : 'info'} title={['draft', 'returned'].includes(current.status) ? `当前由${current.applicant_name || '指定填写人'}填写或修订，你仅可查看，不能代为提交。` : current.status === 'published' ? `${record.stage?.toUpperCase()}已发布，基线只读。` : current.status === 'approved' ? `${record.stage?.toUpperCase()}阶段已批准，等待指定发布人发布。` : `阶段处理中，基础内容已锁定。负责人进入${record.stage?.toUpperCase()}行动页处理任务。`} />}
    {unknown && <Alert type="warning" title="提交结果未确认，原UUID已保留" action={<><Button disabled={busy || leaving} onClick={() => void check()}>查询结果</Button><Button disabled={busy || leaving} onClick={() => void send(unknown)}>按原请求重试</Button></>} />}
    {error && <Alert type="error" title={error} />}
    <Button disabled={busy || !!unknown || leaving || publisher.pending} onClick={onPrevious}>上一页</Button>
  </>
}
