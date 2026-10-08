import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Descriptions, Drawer, Input, Modal, Select, Spin, Tag } from 'antd'
import { api, type ChangeRequest } from './api'
import { actorUser } from './workflow'
import { newestResponse } from './latestResponse'
import { saveResultUnconfirmed } from './questionDraft'
import { requestFeedbackDrawer, registerReviewDrawer } from './systemFeedback'
import { modeLabel } from './submission'
import { checkedReview, actionConfirmed, actionCanRetry, approvalProgress, approvalBlockReason, editReply, type ReplyDraft, reviewPath, reviewStateLabels as labels, issueTabs, issueStateLabels, type IssueInput, type ReviewAction, type ReviewData } from './review'

type Props = { compact?: boolean; initialOpen?: boolean; changeId: number; number: number; leaving?: boolean; onBack?: () => void; onReauthenticate: () => void; onBusy?: (value: boolean) => void; onDirty?: (value: boolean) => void; renderForm?: (record: ChangeRequest) => ReactNode }

export default function ReviewPanel({ compact = false, initialOpen = false, changeId, number, leaving = false, onBack, onReauthenticate, onBusy, onDirty, renderForm }: Props) {
  const client = useQueryClient(), actor = actorUser(client)
  const { modal, message } = App.useApp()
  const key = ['review-round', actor.id, changeId, number], path = reviewPath(changeId, number)
  const active = useRef(true), flight = useRef(false), callbacks = useRef({ onBusy, onDirty })
  useEffect(() => { callbacks.current = { onBusy, onDirty } }, [onBusy, onDirty])
  useEffect(() => { active.current = true; return () => { active.current = false; callbacks.current.onBusy?.(false); callbacks.current.onDirty?.(false) } }, [])
  const [drafts, setDrafts] = useState<IssueInput[]>([]), [replies, setReplies] = useState<Record<number, ReplyDraft>>({}), [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(initialOpen)
  const [confirm, setConfirm] = useState<'approve' | 'return' | null>(null), [unknown, setUnknown] = useState<ReviewAction | null>(null), [error, setError] = useState<string | null>(null)
  const openReview = () => requestFeedbackDrawer('review', () => setOpen(true))
  useEffect(() => {
    const switchDrawer = (event: Event) => {
      const request = event as CustomEvent<{ kind: string; open: () => void }>
      if (!['system', 'inbox'].includes(request.detail.kind) || (!open && !busy && !unknown && !confirm)) return
      request.preventDefault()
      if (busy || unknown || confirm) { message.warning('请先确认当前审核操作结果。'); return }
      const next = () => { setOpen(false); request.detail.open() }
      if (drafts.length || Object.values(replies).some((row) => !!row.text)) modal.confirm({ title: '保留审核意见并切换？', content: '未发送文字保留在当前申请中，返回审核意见后可继续填写。', okText: '保留并切换', cancelText: '继续填写', onOk: next })
      else next()
    }
    window.addEventListener('feedback-drawer-request', switchDrawer)
    return () => window.removeEventListener('feedback-drawer-request', switchDrawer)
  }, [open, busy, unknown, confirm, drafts, replies, modal, message])
  const accept = (incoming: ReviewData) => {
    if (!active.current || actorUser(client)?.id !== actor.id) return incoming
    const latest = newestResponse(client.getQueryData<ReviewData>(key), incoming)
    client.setQueryData(key, latest)
    if (latest.form && actor.role === 'filler') client.setQueryData<ChangeRequest>(['change', actor.id, changeId], (current) => newestResponse(current, latest.form!))
    for (const resource of ['review-list', 'changes', 'submission', 'review-inbox']) void client.invalidateQueries({ queryKey: [resource, actor.id] })
    return latest
  }
  const query = useQuery({ queryKey: key, refetchOnWindowFocus: false, queryFn: async () => accept(checkedReview(await api<unknown>(path, 'GET', undefined, actor.id), changeId, number)) })
  const data = query.data
  useEffect(() => registerReviewDrawer(() => requestFeedbackDrawer('review', () => setOpen(true)), data?.unresolved_count ?? 0), [data?.unresolved_count])
  const unresolved = !!unknown
  useEffect(() => { onBusy?.(busy || unresolved || !!confirm); onDirty?.(drafts.length > 0 || Object.values(replies).some((reply) => !!reply.text) || !!unknown) }, [onBusy, onDirty, busy, unresolved, confirm, drafts, replies, unknown])
  const settle = (action: ReviewAction, result: ReviewData) => {
    const latest = accept(result)
    if (actionConfirmed(action, latest, actor.id)) {
      setUnknown(null); setError(null)
      if (action.kind === 'approve') message.success(latest.round.state === 'approved' ? '整份申请审核已通过。' : `你的批准已记录。${approvalProgress(latest.round)}`)
      if (action.kind === 'return') setDrafts([])
      if (action.issue_id) setReplies((current) => { const next = { ...current }; delete next[action.issue_id!]; return next })
    } else if (!actionCanRetry(action, latest)) {
      setUnknown(null); setError('当前状态已变化，原请求不能继续执行；未发送文字仍保留，请核对审核记录。')
    }
    return latest
  }
  const perform = async (action: ReviewAction) => {
    if (flight.current || !active.current) return
    flight.current = true; setBusy(true); setConfirm(null); setError(null)
    const { kind: _kind, ...payload } = action
    void _kind
    try { settle(action, checkedReview(await api<unknown>(path + action.kind + '/', 'POST', payload, actor.id), changeId, number)) }
    catch (failure) {
      if (!active.current) return
      openReview()
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
  const approvalReason = unknown ? '上次操作结果未确认，请先查询结果。' : busy ? '审核操作正在提交，请等待结果。'
    : leaving ? '正在离开或重新登录，请完成后继续审核。' : confirm ? '请先完成或取消当前确认。'
      : data ? approvalBlockReason(data, actor.id, drafts.length) : '审核记录尚未读取。'
  const newAction = (kind: ReviewAction['kind'], fields: Partial<ReviewAction> = {}): ReviewAction => ({ kind, request_id: crypto.randomUUID(), ...fields })
  const validDrafts = drafts.length > 0 && drafts.every((row) => row.text.trim() && (row.issue_id || row.tab))
  const add = () => { openReview(); setDrafts((current) => [...current, { tab: 'overview', location: '', text: '' }]) }
  return <>
    {query.error && <Alert type="error" title="审核记录读取失败" description={query.error.message} action={<Button disabled={busy} onClick={() => void query.refetch()}>重试</Button>} className="form-alert" />}
    {!data ? query.isPending && <Spin tip="正在读取审核轮次…"><div className="loading-space" /></Spin> : <>
      {!compact && <section className="panel list-panel material-section">
        <div className="section-heading"><h2>第{data.round.number}轮审核 <Tag>{labels[data.round.state]}</Tag>{!data.is_current && <Tag>历史轮次</Tag>}</h2><div className="form-actions"><Button disabled={blocked} onClick={() => void query.refetch()}>刷新记录</Button>{onBack && <Button disabled={busy || unresolved || leaving} onClick={onBack}>返回审核列表</Button>}</div></div>
        <Descriptions column={1} items={[{ key: 'title', label: '提交时标题', children: data.round.title }, { key: 'numbers', label: '提交时编号', children: `ECR：${data.round.ecr_no} · ECO：${data.round.eco_no || '未填写'}` }, { key: 'mode', label: '方式', children: modeLabel(data.round.review_mode) }, { key: 'people', label: '指定人员', children: data.round.reviewers.map((row) => row.display_name).join('、') || '不指定人员' }, { key: 'approved', label: '个人通过', children: data.round.approvals.map((row) => `${row.display_name}（${new Date(row.approved_at).toLocaleString('zh-CN')}）`).join('、') || '尚无人通过' }]} />
        {data.round.returned_by && <Alert type="warning" title={`退回人：${data.round.returned_by.display_name}`} description={<div className="question-text">{data.round.return_reason}</div>} className="form-alert" />}
        {!data.can_view_form && actor.role === 'reviewer' && <Alert type="info" title="当前仅开放基本信息与意见记录；修订中的表单和历史完整表单不开放。" className="form-alert" />}
        <Alert type={data.round.state === 'approved' ? 'success' : 'info'} showIcon title={approvalProgress(data.round)} description={data.round.review_mode === 'public' ? '公开审核需要两名不同审核员同意批准，无须先退回修改；达到人数条件后自动批准整份申请。' : '指定审核需要全部指定人员同意批准；达到人数条件后自动批准整份申请。'} className="form-alert" />
        <div className="review-actions"><div className="form-actions">{data.is_current && data.round.state === 'pending' && actor.role === 'reviewer' && <Button type="primary" disabled={!!approvalReason} onClick={() => setConfirm('approve')}>本人同意批准</Button>}{data.can_return && <Button danger disabled={blocked} onClick={() => { openReview(); if (!drafts.length) setDrafts([{ tab: 'overview', location: '', text: '' }]) }}>列出修改意见并退回</Button>}<Button disabled={busy} onClick={openReview}>查看审核意见（{data.unresolved_count}）</Button></div><Button disabled={busy || !!confirm} onClick={onReauthenticate}>重新登录</Button></div>
        {data.is_current && data.round.state === 'pending' && actor.role === 'reviewer' && approvalReason && <p role="status">暂不能批准：{approvalReason}</p>}
        {data.unresolved_count > 0 && <Alert type="warning" title={`尚有 ${data.unresolved_count} 条未解决意见，全部解决后才能批准。`} className="form-alert" />}
      </section>}
      {renderForm && data.can_view_form && data.form && renderForm(data.form)}
      {!compact && <section className="panel list-panel material-section"><h2>审核过程</h2>{data.history.map((round) => <p key={round.number}>第{round.number}轮 · {labels[round.state]} · {modeLabel(round.review_mode)} · {new Date(round.submitted_at).toLocaleString('zh-CN')}{round.return_reason && ` · 退回原因：${round.return_reason}`}</p>)}</section>}
      <Drawer title={`审核修改意见 · 未解决 ${data.unresolved_count} 条`} open={open} size={640} extra={<Button disabled={busy || !!unknown || !!confirm} onClick={() => window.dispatchEvent(new Event('system-feedback-open'))}>系统反馈</Button>} onClose={() => { if (!busy && !unknown && !confirm) setOpen(false) }} closable={!busy && !unknown && !confirm} maskClosable={!busy && !unknown && !confirm} keyboard={!busy && !unknown && !confirm}>
        <p className="muted">整份申请共用此意见清单。正式意见保留原提出者及轮次；填写员已回应不等于审核员已确认解决。</p>
        <Button disabled={blocked} onClick={() => void query.refetch()}>刷新意见</Button>
        {data.issue_blockers.map((text) => <Alert key={text} type="warning" title={text} className="form-alert" />)}
        {unknown && <Alert type="warning" title="操作结果未确认，原请求及输入已保留" className="form-alert" action={<div className="form-actions"><Button disabled={busy || leaving} onClick={() => void check()}>查询结果</Button><Button disabled={busy || leaving} onClick={() => void perform(unknown)}>按原请求重试</Button></div>} />}
        {error && <Alert type="error" title={error} className="form-alert" />}
        {!data.issues.length && <p>暂无正式审核意见。</p>}
        {data.issues.map((issue) => <section className="review-note" key={issue.id}>
          <strong>意见 #{issue.id} · {issueTabs[issue.tab as keyof typeof issueTabs]} {issue.location}</strong><p><Tag>{issueStateLabels[issue.state]}</Tag>提出者：{issue.author.display_name} · 第{issue.source_round}轮</p><p className="question-text">{issue.text}</p>
          {issue.events.map((item, index) => <p className="question-text" key={index}>第{item.round_number}轮 · {item.kind === 'respond' ? '填写员回应' : item.kind === 'resolve' ? '原提出者确认解决' : '要求修改'} · {new Date(item.created_at).toLocaleString('zh-CN')}：{item.text}</p>)}
          {(issue.can_respond || issue.can_resolve || issue.can_reject) && <Input.TextArea aria-label={`意见${issue.id}处理说明`} maxLength={10000} disabled={blocked} value={replies[issue.id]?.text ?? ''} onChange={(event) => setReplies((current) => ({ ...current, [issue.id]: editReply(current[issue.id], event.target.value, issue.version) }))} placeholder={issue.can_respond ? '说明修改情况或不修改的原因' : '确认解决或继续要求修改的说明'} autoSize={{ minRows: 2, maxRows: 8 }} />}
          {!!replies[issue.id]?.text && replies[issue.id].version !== issue.version && <Alert type="warning" title="意见已更新，未发送文字保留；请核对最新记录，清除后重新填写。" className="form-alert" />}
          <div className="form-actions">
            {!!replies[issue.id]?.text && <Button disabled={blocked} onClick={() => setReplies((current) => { const next = { ...current }; delete next[issue.id]; return next })}>清除未发送文字</Button>}
            {issue.can_respond && <Button disabled={blocked || !replies[issue.id]?.text.trim() || replies[issue.id]?.version !== issue.version} onClick={() => void perform(newAction('respond', { issue_id: issue.id, version: replies[issue.id].version, text: replies[issue.id].text.trim() }))}>提交回应，待复核</Button>}
            {issue.can_resolve && <Button disabled={blocked || !replies[issue.id]?.text.trim() || replies[issue.id]?.version !== issue.version} onClick={() => void perform(newAction('resolve', { issue_id: issue.id, version: replies[issue.id].version, text: replies[issue.id].text.trim() }))}>确认解决</Button>}
            {issue.can_reject && <Button disabled={blocked || !replies[issue.id]?.text.trim() || replies[issue.id]?.version !== issue.version || drafts.some((row) => row.issue_id === issue.id)} onClick={() => { setDrafts((current) => [...current, { issue_id: issue.id, version: replies[issue.id].version, text: replies[issue.id].text.trim() }]); setReplies((current) => ({ ...current, [issue.id]: editReply(current[issue.id], '', issue.version) })) }}>加入继续修改清单</Button>}
          </div>
          {!!replies[issue.id]?.text && !issue.can_respond && !issue.can_resolve && !issue.can_reject && <Alert type="warning" title="以下文字尚未发送，可复制后保留" description={<p className="question-text">{replies[issue.id].text}</p>} />}
        </section>)}
        {data.can_return && <>
          <h3>本次退回清单</h3><Button disabled={blocked} onClick={add}>新增修改意见</Button>
          {drafts.map((row, index) => <section className="review-note" key={index}>
            {row.issue_id ? <p>继续修改意见 #{row.issue_id}</p> : <><Select aria-label={`意见${index + 1}所属页签`} disabled={blocked} value={row.tab} options={Object.entries(issueTabs).map(([value, label]) => ({ value, label }))} style={{ width: '100%' }} onChange={(tab) => setDrafts((current) => current.map((item, i) => i === index ? { ...item, tab } : item))} /><Input aria-label={`意见${index + 1}定位说明`} disabled={blocked} maxLength={255} value={row.location} placeholder="可选：题号、行动号或物料信息" onChange={(event) => setDrafts((current) => current.map((item, i) => i === index ? { ...item, location: event.target.value } : item))} /></>}
            <Input.TextArea aria-label={`意见${index + 1}具体问题`} disabled={blocked} maxLength={10000} value={row.text} placeholder="具体问题／继续修改理由" autoSize={{ minRows: 2, maxRows: 8 }} onChange={(event) => setDrafts((current) => current.map((item, i) => i === index ? { ...item, text: event.target.value } : item))} />
            <Button disabled={blocked} onClick={() => setDrafts((current) => current.filter((_, i) => i !== index))}>删除未提交意见</Button>
          </section>)}
          <Button danger disabled={blocked || !validDrafts} onClick={() => setConfirm('return')}>确认清单并退回整单</Button>
        </>}
        {!data.can_return && drafts.length > 0 && <Alert type="warning" title="本轮不能再退回，以下意见尚未提交" description={drafts.map((row, i) => <p className="question-text" key={i}>{row.text}</p>)} />}
        <h3>审核过程</h3>{data.history.map((round) => <p key={round.number}>第{round.number}轮 · {labels[round.state]}{round.return_reason && ` · ${round.return_reason}`}</p>)}
        <h3>历史留言，只读</h3>{data.feedback.map((note) => <div className="review-note" key={note.id}><strong>第{note.round_number}轮 · {note.author.display_name}</strong><span className="muted"> · {new Date(note.created_at).toLocaleString('zh-CN')}</span><p className="question-text">{note.text}</p></div>)}
      </Drawer>
    </>}
    <Modal open={!!confirm} title={confirm === 'return' ? '确认多条意见并退回整单？' : '同意批准整份申请？'} okText={confirm === 'return' ? '确认退回' : '确认批准'} cancelText="继续检查" onCancel={() => setConfirm(null)} okButtonProps={{ disabled: confirm === 'return' && !validDrafts, danger: confirm === 'return' }} onOk={() => { if (confirm) void perform(newAction(confirm, confirm === 'return' ? { issues: drafts.map((row) => ({ ...row, text: row.text.trim() })) } : {})) }}>
      {confirm === 'return' ? <><p>以下清单一次提交并结束本轮，填写员须逐条回应后重提。</p>{drafts.map((row, index) => <p className="question-text" key={index}>{index + 1}. {row.issue_id ? `意见 #${row.issue_id}` : issueTabs[row.tab as keyof typeof issueTabs]} {row.location}：{row.text}</p>)}</> : <><p>此操作记录你对整份申请的批准，与单条意见的“确认解决”不同。</p><p>{data && approvalProgress(data.round)}</p><p>达到人数条件后自动完成整单审核，无需另点整单通过按钮。</p></>}
    </Modal>
  </>
}
