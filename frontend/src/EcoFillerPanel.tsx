import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Select, Space } from 'antd'
import { api, ApiError, type ChangeRequest, type User } from './api'
import { checkedReviewers } from './submission'
import { newestResponse } from './latestResponse'
import { saveResultUnconfirmed } from './questionDraft'
import { checkedFillerData, checkedFillerReceipt, type FillerData, type TransferPayload } from './ecoFiller'

export default function EcoFillerPanel({ record, leaving, onBusy, onReauthenticate }: { record: ChangeRequest; leaving: boolean; onBusy: (busy: boolean) => void; onReauthenticate: () => void }) {
  const client = useQueryClient(), actor = client.getQueryData<User>(['me'])!.id, { modal, message } = App.useApp()
  const path = `/api/changes/${record.id}/eco-filler/`, key = ['eco-filler', actor, record.id]
  const [target, setTarget] = useState<number | undefined>(), [busy, setBusy] = useState(false), [unknown, setUnknown] = useState<TransferPayload | null>(null), [error, setError] = useState('')
  const active = useRef(true), callbacks = useRef(onBusy)
  useEffect(() => { callbacks.current = onBusy }, [onBusy])
  useEffect(() => { active.current = true; return () => { active.current = false; callbacks.current(false) } }, [])
  useEffect(() => { onBusy(busy || !!unknown) }, [busy, unknown, onBusy])
  const accept = (value: unknown) => {
    const incoming = checkedFillerData(value, record.id, actor)
    if (!active.current || client.getQueryData<User>(['me'])?.id !== actor) throw new Error('当前账号或页面已变化。')
    const existing = client.getQueryData<FillerData>(key)
    const latest = existing && newestResponse(existing.change, incoming.change) === existing.change ? existing : incoming
    client.setQueryData(key, latest)
    client.setQueryData<ChangeRequest>(['change', actor, record.id], current => newestResponse(current, latest.change))
    return latest
  }
  const query = useQuery({ queryKey: key, refetchOnWindowFocus: false, queryFn: async () => accept(await api(path, 'GET', undefined, actor)) })
  const people = useQuery({ queryKey: ['action-owners', actor], enabled: !!query.data?.can_transfer, queryFn: async () => checkedReviewers(await api('/api/action-owners/', 'GET', undefined, actor)) })
  const finish = (payload: TransferPayload, result: unknown, assignment: unknown | null) => {
    const receipt = checkedFillerReceipt(result, record.id, actor, payload)
    if (receipt.kind !== 'transfer' || receipt.previous_filler_id !== payload.expected_filler_id) throw new ApiError(200, '交接回执与原请求不一致。')
    if (!active.current || client.getQueryData<User>(['me'])?.id !== actor) return
    if (assignment !== null) accept(assignment)
    setUnknown(null); setError(''); setTarget(undefined)
    for (const resource of ['changes', 'eco-filler', 'review-round', 'review-list', 'review-inbox', 'stage-workflow', 'stage-navigation', 'publication']) void client.invalidateQueries({ queryKey: [resource, actor] })
    message.success('ECO填写人交接已记录。')
    if (assignment === null) {
      client.removeQueries({ queryKey: ['change', actor, record.id] })
      window.dispatchEvent(new CustomEvent('eco-filler-handed-off', { detail: { actor_id: actor, change_id: record.id } }))
    }
  }
  const check = async (payload: TransferPayload) => {
    const receipt = await api(path + `requests/${payload.request_id}/`, 'GET', undefined, actor)
    checkedFillerReceipt(receipt, record.id, actor, payload)
    let assignment: unknown | null = null
    try { assignment = await api(path, 'GET', undefined, actor) } catch (failure) { if (!(failure instanceof ApiError && failure.status === 404)) throw failure }
    finish(payload, receipt, assignment)
  }
  const run = async (payload: TransferPayload) => {
    setBusy(true); setError('')
    try {
      const result = await api<{ receipt: unknown; assignment: unknown | null }>(path, 'POST', payload, actor)
      finish(payload, result.receipt, result.assignment)
    } catch (failure) {
      if (!active.current || client.getQueryData<User>(['me'])?.id !== actor) return
      try { await check(payload); return } catch { /* Keep original intent when a response is ambiguous. */ }
      setUnknown(saveResultUnconfirmed(failure) || failure instanceof ApiError && [401, 403].includes(failure.status) ? payload : null)
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally { if (active.current) setBusy(false) }
  }
  const recover = async () => {
    if (!unknown) return
    setBusy(true); setError('')
    try { await check(unknown) } catch (failure) { if (active.current) setError(failure instanceof Error ? failure.message : String(failure)) } finally { if (active.current) setBusy(false) }
  }
  const data = query.data, disabled = leaving || busy || !!unknown
  return <section className="panel form-alert eco-filler-panel"><div className="eco-filler-heading"><div><h2>ECO填写人</h2>
    {data && <p>{data.filler.display_name}（{data.filler.username}）{!data.filler.is_active && ' · 已停用'}</p>}</div>
    <Button disabled={disabled} onClick={() => void query.refetch()}>刷新填写人</Button></div>
    {data && data.filler.id !== actor && <p className="muted">当前由上述人员填写；你可按权限查看，不能代为修改或提交。</p>}
    {data?.can_transfer && <><Space wrap><Select aria-label="新的ECO填写人" style={{ minWidth: 280 }} disabled={disabled} value={target} placeholder="选择新的填写人，包括自己" showSearch optionFilterProp="label" options={(people.data ?? []).filter(person => person.id !== data.filler.id).map(person => ({ value: person.id, label: `${person.display_name}（${person.username}）` }))} onChange={setTarget} />
      <Button disabled={disabled || !target} loading={busy} onClick={() => modal.confirm({ title: '更换ECO填写人？', content: '已保存内容和历史保持不变，新填写人负责后续填写与提交；发布人不会自动改变。', onOk: () => run({ request_id: crypto.randomUUID(), filler_id: target!, expected_filler_id: data.filler.id, expected_updated_at: data.change.updated_at }) })}>更换填写人</Button></Space><p className="muted">交接前请先保存当前页面，未保存、正在保存或结果未确认时不能交接。</p></>}
    {(error || query.error || people.error) && <Alert type="error" title={error || query.error?.message || people.error?.message} />}
    {people.error && <Button disabled={disabled} onClick={() => void people.refetch()}>重试读取填写人名单</Button>}
    {unknown && <Space wrap><Button disabled={busy || leaving} onClick={() => void recover()}>查询交接结果</Button><Button disabled={busy || leaving} onClick={() => void run(unknown)}>按原请求重试</Button><Button disabled={busy || leaving} onClick={onReauthenticate}>原账号重新登录</Button></Space>}
    {unknown && <Alert type="warning" title="交接结果未确认，原请求及填写人选择已保留，请先查询或重试。" />}
    {!!data?.history.length && <details><summary>填写人历史（{data.history.length}条）</summary>{data.history.map((event, index) => <p key={event.request_id ?? `baseline-${index}`}>{new Date(event.created_at).toLocaleString('zh-CN')} · {event.kind === 'baseline' ? `历史基线：${event.filler.display_name}` : event.kind === 'create' ? `${event.actor?.display_name}创建，指定${event.filler.display_name}` : `${event.actor?.display_name}交接：${event.previous_filler?.display_name} → ${event.filler.display_name}`}</p>)}</details>}
  </section>
}
