import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Descriptions, Input, Modal, Spin, Tag } from 'antd'
import { api, type ChangeRequest } from './api'
import { actorUser } from './workflow'
import { newestResponse } from './latestResponse'
import { saveResultUnconfirmed } from './questionDraft'
import { modeLabel } from './submission'
import { checkedReview, actionConfirmed, reviewPath, reviewStateLabels as labels, type ReviewAction, type ReviewData } from './review'

type Props = { changeId: number; number: number; leaving?: boolean; onBack?: () => void; onReauthenticate: () => void; onBusy?: (value: boolean) => void; onDirty?: (value: boolean) => void; renderForm?: (record: ChangeRequest) => ReactNode }

export default function ReviewPanel({ changeId, number, leaving = false, onBack, onReauthenticate, onBusy, onDirty, renderForm }: Props) {
  const client = useQueryClient(), actor = actorUser(client)
  const key = ['review-round', actor.id, changeId, number], path = reviewPath(changeId, number)
  const active = useRef(true), flight = useRef(false), callbacks = useRef({ onBusy, onDirty })
  useEffect(() => { callbacks.current = { onBusy, onDirty } }, [onBusy, onDirty])
  useEffect(() => { active.current = true; return () => { active.current = false; callbacks.current.onBusy?.(false); callbacks.current.onDirty?.(false) } }, [])
  const [text, setText] = useState(''), [reason, setReason] = useState(''), [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<'approve' | 'return' | null>(null), [unknown, setUnknown] = useState<ReviewAction | null>(null), [error, setError] = useState<string | null>(null)
  const accept = (incoming: ReviewData) => {
    if (!active.current || actorUser(client)?.id !== actor.id) return incoming
    const latest = newestResponse(client.getQueryData<ReviewData>(key), incoming)
    client.setQueryData(key, latest)
    if (latest.form && actor.role === 'filler') client.setQueryData<ChangeRequest>(['change', actor.id, changeId], (current) => newestResponse(current, latest.form!))
    for (const resource of ['review-list', 'changes', 'submission']) void client.invalidateQueries({ queryKey: [resource, actor.id] })
    return latest
  }
  const query = useQuery({ queryKey: key, refetchOnWindowFocus: false, queryFn: async () => accept(checkedReview(await api<unknown>(path, 'GET', undefined, actor.id), changeId, number)) })
  const data = query.data
  const unresolved = !!unknown && !!data?.is_current && data.round.state === 'pending'
  useEffect(() => { onBusy?.(busy || unresolved || !!confirm); onDirty?.(!!text || !!reason || !!unknown) }, [onBusy, onDirty, busy, unresolved, confirm, text, reason, unknown])
  const settle = (action: ReviewAction, result: ReviewData) => {
    const latest = accept(result)
    if (actionConfirmed(action, latest, actor.id)) {
      setUnknown(null); setError(null)
      if (action.kind === 'feedback') setText('')
      if (action.kind === 'return') setReason('')
    } else if (!latest.is_current || (action.kind === 'feedback' ? !latest.can_feedback : !latest.can_return)) {
      setUnknown(null); setError('该轮已结束，请核对审核记录。')
    }
    return latest
  }
  const perform = async (action: ReviewAction) => {
    if (flight.current || !active.current) return
    flight.current = true; setBusy(true); setConfirm(null); setError(null)
    const payload = action.kind === 'approve' ? {} : { text: action.text, ...(action.kind === 'feedback' ? { request_id: action.request_id } : {}) }
    try { settle(action, checkedReview(await api<unknown>(path + action.kind + '/', 'POST', payload, actor.id), changeId, number)) }
    catch (failure) {
      if (!active.current) return
      const known = client.getQueryData<ReviewData>(key)
      if (known && actionConfirmed(action, known, actor.id)) settle(action, known)
      else if (saveResultUnconfirmed(failure)) { setUnknown(action); setError('操作结果未确认，请查询或按原请求重试。') }
      else {
        try {
          const fresh = settle(action, checkedReview(await api<unknown>(path, 'GET', undefined, actor.id), changeId, number))
          if (active.current && !actionConfirmed(action, fresh, actor.id)) { setUnknown(null); setError(failure instanceof Error ? failure.message : String(failure)) }
        } catch (readError) { if (active.current) setError(readError instanceof Error ? readError.message : String(readError)) }
      }
    } finally { flight.current = false; if (active.current) setBusy(false) }
  }
  const check = async () => {
    if (!unknown || flight.current) return
    flight.current = true; setBusy(true)
    try { settle(unknown, checkedReview(await api<unknown>(path, 'GET', undefined, actor.id), changeId, number)) }
    catch (failure) { if (active.current) setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { flight.current = false; if (active.current) setBusy(false) }
  }
  const blocked = leaving || busy || !!unknown || !!confirm
  return <>
    {query.error && <Alert type="error" title="审核记录读取失败" description={query.error.message} action={<Button disabled={busy} onClick={() => void query.refetch()}>重试</Button>} className="form-alert" />}
    {!data ? query.isPending && <Spin tip="正在读取审核轮次…"><div className="loading-space" /></Spin> : <>
      <section className="panel list-panel material-section">
        <div className="section-heading"><h2>第{data.round.number}轮审核 <Tag>{labels[data.round.state]}</Tag>{!data.is_current && <Tag>历史轮次</Tag>}</h2><div className="form-actions"><Button disabled={busy} onClick={() => void query.refetch()}>刷新记录</Button>{onBack && <Button disabled={busy || unresolved} onClick={onBack}>返回审核列表</Button>}</div></div>
        <Descriptions column={1} items={[{ key: 'title', label: '提交时标题', children: data.round.title }, { key: 'numbers', label: '提交时编号', children: `ECR：${data.round.ecr_no} · ECO：${data.round.eco_no || '未填写'}` }, { key: 'mode', label: '方式', children: modeLabel(data.round.review_mode) }, { key: 'people', label: '指定人员', children: data.round.reviewers.map((row) => row.display_name).join('、') || '不指定人员' }, { key: 'approved', label: '个人通过', children: data.round.approvals.map((row) => `${row.display_name}（${new Date(row.approved_at).toLocaleString('zh-CN')}）`).join('、') || '尚无人通过' }]} />
        {data.round.returned_by && <Alert type="warning" title={`退回人：${data.round.returned_by.display_name}`} description={<div className="question-text">{data.round.return_reason}</div>} className="form-alert" />}
        {!data.can_view_form && actor.role === 'reviewer' && <Alert type="info" title="当前仅开放基本信息与意见记录；修订中的表单和历史完整表单不开放。" className="form-alert" />}
        <div className="form-actions">{data.can_approve && <Button type="primary" disabled={blocked} onClick={() => setConfirm('approve')}>通过本轮</Button>}{data.can_return && <Button danger disabled={blocked} onClick={() => setConfirm('return')}>退回整单</Button>}<Button disabled={busy || !!confirm} onClick={onReauthenticate}>重新登录</Button></div>
        {unknown && <Alert type="warning" title="操作结果未确认" className="form-alert" action={<div className="form-actions"><Button disabled={busy || leaving} onClick={() => void check()}>查询结果</Button><Button disabled={busy || leaving} onClick={() => void perform(unknown)}>按原请求重试</Button></div>} />}
        {!data.can_feedback && text && <Alert type="warning" title="本轮已不能追加反馈，以下文字尚未发送" description={<p className="question-text">{text}</p>} action={<Button onClick={() => setText('')}>清除未发送文字</Button>} className="form-alert" />}
        {!data.can_return && reason && <Alert type="warning" title="以下退回原因尚未提交" description={<p className="question-text">{reason}</p>} action={<Button onClick={() => setReason('')}>清除未提交原因</Button>} className="form-alert" />}
        {error && <Alert type="error" title={error} className="form-alert" />}
      </section>
      {renderForm && data.can_view_form && data.form && renderForm(data.form)}
      <section className="panel list-panel material-section"><h2>审核过程与意见</h2>
        <p className="muted">保留每轮过程记录，不提供完整旧表单快照。新一轮重新计算批准，旧意见只读保留。</p>
        {data.history.map((round) => <p key={round.number}>第{round.number}轮 · {labels[round.state]} · {modeLabel(round.review_mode)} · {new Date(round.submitted_at).toLocaleString('zh-CN')}{round.return_reason && ` · 退回原因：${round.return_reason}`}</p>)}
        {data.feedback.map((note) => <div className="review-note" key={note.id}><strong>第{note.round_number}轮 · {note.author.display_name}</strong><span className="muted"> · {new Date(note.created_at).toLocaleString('zh-CN')}</span><p className="question-text">{note.text}</p></div>)}
        {data.can_feedback && <><Input.TextArea aria-label="自由文字反馈" maxLength={10000} disabled={blocked} value={text} autoSize={{ minRows: 3, maxRows: 10 }} placeholder="写下意见、想法、疑问或修改说明" onChange={(event) => setText(event.target.value)} /><Button disabled={blocked || !text.trim()} onClick={() => void perform({ kind: 'feedback', text: text.trim(), request_id: crypto.randomUUID() })}>追加反馈</Button></>}
      </section>
    </>}
    <Modal open={!!confirm} title={confirm === 'return' ? '退回整单？' : '确认通过本轮？'} okText={confirm === 'return' ? '确认退回' : '确认通过'} cancelText="继续检查" onCancel={() => setConfirm(null)} okButtonProps={{ disabled: confirm === 'return' && !reason.trim(), danger: confirm === 'return' }} onOk={() => { if (confirm) void perform({ kind: confirm, ...(confirm === 'return' ? { text: reason.trim() } : {}) }) }}>
      {confirm === 'return' ? <><p>本轮结束，填写员可修改后重新提交。退回原因必填。</p><Input.TextArea aria-label="退回原因" maxLength={10000} value={reason} onChange={(event) => setReason(event.target.value)} autoSize={{ minRows: 3, maxRows: 10 }} /></> : <p>这是本人的通过记录；达到本轮整体通过条件时才结束审核。</p>}
    </Modal>
  </>
}
