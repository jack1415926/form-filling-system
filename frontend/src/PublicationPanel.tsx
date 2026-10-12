import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Space } from 'antd'
import { api, ApiError, type ChangeRequest, type User } from './api'
import { newestResponse } from './latestResponse'
import { saveResultUnconfirmed } from './questionDraft'
import { checkedPublication, checkedCreatedEco, publicationSettled, newestPublication, type PublicationData, type PublicationOperation } from './publication'

export default function PublicationPanel({ record, leaving, onBusy, onReauthenticate, onOpenChange }: {
  record: ChangeRequest; leaving: boolean; onBusy: (busy: boolean) => void; onReauthenticate: () => void; onOpenChange?: (id: number) => void
}) {
  const client = useQueryClient(), actor = client.getQueryData<User>(['me'])!.id, { modal } = App.useApp()
  const key = ['publication', actor, record.id]
  const [busy, setBusy] = useState(false), [unknown, setUnknown] = useState<PublicationOperation | null>(null), [error, setError] = useState('')
  const active = useRef(true), callbacks = useRef(onBusy)
  useEffect(() => { callbacks.current = onBusy }, [onBusy])
  useEffect(() => { active.current = true; return () => { active.current = false; callbacks.current(false) } }, [])
  useEffect(() => { onBusy(busy || !!unknown) }, [busy, unknown, onBusy])
  const accept = (value: unknown) => {
    const incoming = checkedPublication(value, record.id, actor)
    if (!active.current || client.getQueryData<User>(['me'])?.id !== actor) throw new Error('账号或页面已变化。')
    const previous = client.getQueryData<PublicationData>(key)
    const latest = newestPublication(previous, incoming)
    client.setQueryData(key, latest)
    client.setQueryData<ChangeRequest>(['change', actor, record.id], current => newestResponse(current, latest.change))
    return latest
  }
  const read = async () => accept(await api(`/api/changes/${record.id}/publication/`, 'GET', undefined, actor))
  const query = useQuery({ queryKey: key, refetchOnWindowFocus: false, queryFn: read })
  const refresh = () => { for (const resource of ['changes', 'publications', 'ecr-publications', 'review-round', 'stage-workflow', 'stage-navigation']) void client.invalidateQueries({ queryKey: [resource, actor] }) }
  const settle = (data: PublicationData, operation: PublicationOperation) => {
    if (publicationSettled(data, operation)) { setUnknown(null); setError(''); refresh() }
    else { setUnknown(operation); setError('原操作结果尚未确认，请查询或按原请求重试。') }
  }
  const run = async (operation: PublicationOperation) => {
    setBusy(true); setError('')
    try {
      if (operation.kind === 'publish') {
        settle(accept(await api(`/api/changes/${record.id}/publication/`, 'POST', { request_id: operation.request_id, expected_round: operation.expected_round }, actor)), operation)
      } else {
        const eco = checkedCreatedEco(await api(`/api/changes/${record.id}/eco/`, 'POST', { request_id: operation.request_id }, actor), record.id, actor)
        if (!active.current || client.getQueryData<User>(['me'])?.id !== actor) return
        client.setQueryData<ChangeRequest>(['change', actor, eco.id], current => newestResponse(current, eco))
        // The complete creation response is already evidence, even if the follow-up GET fails.
        client.setQueryData<PublicationData>(key, current => current ? { ...current, eco_id: eco.id, can_create_eco: false } : current)
        setUnknown(null); refresh()
      }
    } catch (failure) {
      if (!active.current || client.getQueryData<User>(['me'])?.id !== actor) return
      if (saveResultUnconfirmed(failure) || failure instanceof ApiError && [401, 403].includes(failure.status)) setUnknown(operation)
      else {
        try { const data = await read(); if (publicationSettled(data, operation)) { settle(data, operation); return } } catch { /* A definitive rejection may be retried with a new operation after review. */ }
        setUnknown(null)
      }
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally { if (active.current) setBusy(false) }
  }
  const check = async () => {
    setBusy(true)
    try { const data = await read(); if (unknown) settle(data, unknown) }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) } finally { setBusy(false) }
  }
  const label = record.stage?.toUpperCase()
  const data = query.data, current = data?.change ?? record, disabled = leaving || busy || !!unknown
  return <section className="panel form-alert">
    <h2>{current.status === 'published' ? `${label}已发布` : current.status === 'approved' ? `${label}已批准，待发布` : `${label}发布`}</h2>
    <p>指定发布人：{data?.publisher_name || '未指定'}{data && !data.publisher_active && '（未指定或已停用）'}</p>
    {current.published_at && <p>发布人账号 #{current.published_by_id} · {new Date(current.published_at).toLocaleString('zh-CN')}</p>}
    {(error || query.error) && <Alert type="error" title={error || query.error?.message} />}
    <Space wrap>
      {data?.can_publish && <Button type="primary" disabled={disabled} onClick={() => modal.confirm({ title: `发布已批准${label}？`, content: record.stage === 'eco' ? '发布后ECO只读且不可撤销，ECR至ECO流程完成。' : '发布后基线只读且不可撤销，原发起人可创建一个关联ECO。', onOk: () => run({ kind: 'publish', request_id: crypto.randomUUID(), expected_round: current.current_review_round }) })}>发布{label}</Button>}
      {data?.can_create_eco && <Button type="primary" disabled={disabled} onClick={() => modal.confirm({ title: '从已发布ECR创建ECO？', content: '复制基础内容为独立草稿，编号稍后填写。关联ECO不能删除，负责人和执行结果从空开始。', onOk: () => run({ kind: 'create', request_id: crypto.randomUUID() }) })}>创建ECO</Button>}
      {data?.eco_id && onOpenChange && <Button disabled={disabled} onClick={() => onOpenChange(data.eco_id!)}>打开关联ECO</Button>}
      <Button disabled={leaving || busy} loading={query.isFetching} onClick={() => void check()}>查询发布与创建结果</Button>
      {unknown && <><Button disabled={leaving || busy} onClick={() => void run(unknown)}>按原请求重试</Button><Button disabled={leaving || busy} onClick={onReauthenticate}>原账号重新登录</Button></>}
    </Space>
    {unknown && <p role="status">操作结果未确认，原请求已保留；请先查询或重试再离开。</p>}
  </section>
}
