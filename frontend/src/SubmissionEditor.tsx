import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Descriptions, Modal, Radio, Select, Spin, Tag } from 'antd'
import { api, type ChangeRequest, type User } from './api'
import { newestResponse } from './latestResponse'
import { canEdit } from './workflow'
import { checkedReviewers, checkedSubmission, newestSubmission, recoverSubmissionFailure, submissionConfirmed, submissionError, modeLabel, type SubmissionData, type SubmissionPayload } from './submission'

type Props = {
  reviewDraftDirty?: boolean
  record: ChangeRequest; leaving: boolean; onDirty: (value: boolean) => void; onBusy: (value: boolean) => void
  onPrevious: () => void; onBack: () => void; onReauthenticate: () => void
}

export default function SubmissionEditor({ record, leaving, onDirty, onBusy, onPrevious, onBack, onReauthenticate, reviewDraftDirty = false }: Props) {
  const queryClient = useQueryClient()
  const key = ['submission', record.applicant, record.id]
  const path = `/api/changes/${record.id}/submission/`
  const active = useRef(true), flight = useRef(false)
  const callbacks = useRef({ onDirty, onBusy })
  useEffect(() => { callbacks.current = { onDirty, onBusy } }, [onDirty, onBusy])
  useEffect(() => { active.current = true; return () => { active.current = false; callbacks.current.onDirty(false); callbacks.current.onBusy(false) } }, [])
  const [mode, setMode] = useState<'' | SubmissionPayload['review_mode']>('')
  const [ids, setIds] = useState<number[]>([])
  const [confirm, setConfirm] = useState<SubmissionPayload | null>(null)
  const [unknown, setUnknown] = useState<SubmissionPayload | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const initialized = useRef(0), choiceEdited = useRef(false)

  const accept = (data: SubmissionData) => {
    const user = queryClient.getQueryData<User>(['me'])
    if (!active.current || user?.id !== record.applicant || user.role !== 'filler') return data
    const latest = newestSubmission(queryClient.getQueryData<SubmissionData>(key), data)
    queryClient.setQueryData(key, latest)
    queryClient.setQueryData<ChangeRequest>(['change', record.applicant, record.id], (current) => newestResponse(current, latest.change))
    void queryClient.invalidateQueries({ queryKey: ['changes', record.applicant] })
    void queryClient.invalidateQueries({ queryKey: ['review-inbox', record.applicant] })
    if (latest.change.status === 'returned' && (latest.review_arrangement_locked || initialized.current !== latest.change.current_review_round)) {
      initialized.current = latest.change.current_review_round
      if (latest.review_arrangement_locked || !choiceEdited.current) { setMode(latest.change.review_mode || ''); setIds(latest.reviewers.map((row) => row.id)) }
    }
    if (!canEdit(latest.change)) {
      setUnknown(null); setConfirm(null); setMode(''); setIds([]); setError(null)
      for (const resource of ['materials', 'questions', 'ecr-actions', 'eco-actions', 'emc', 'execution-plan', 'significant-change']) void queryClient.invalidateQueries({ queryKey: [resource, record.applicant, record.id] })
    }
    return latest
  }
  const submission = useQuery({ queryKey: key, refetchOnWindowFocus: false, queryFn: async () => accept(checkedSubmission(await api<unknown>(path, 'GET', undefined, record.applicant), record)) })
  const reviewers = useQuery({ queryKey: ['reviewers', record.applicant], refetchOnWindowFocus: false, queryFn: async () => checkedReviewers(await api<unknown>('/api/reviewers/', 'GET', undefined, record.applicant)), enabled: canEdit(record) })
  const current = newestResponse(record, submission.data?.change ?? record)
  const locked = !canEdit(current)
  const unresolved = !locked && !!unknown
  const dirty = !locked && (!submission.data?.review_arrangement_locked && (!!mode || ids.length > 0) || !!unknown)
  useEffect(() => { onDirty(dirty); onBusy(busy || unresolved || !!confirm) }, [onDirty, onBusy, dirty, busy, unresolved, confirm])

  const send = async (payload: SubmissionPayload) => {
    if (flight.current || !active.current) return
    flight.current = true; setBusy(true); setConfirm(null); setError(null)
    try { accept(checkedSubmission(await api<unknown>(path, 'POST', payload, record.applicant), record, payload)); if (active.current) { setUnknown(null); setError(null) } }
    catch (failure) {
      if (!active.current) return
      const recovery = await recoverSubmissionFailure({ failure, payload, previousUnknown: !!unknown, owner: record,
        cached: () => queryClient.getQueryData<SubmissionData>(key), read: () => api<unknown>(path, 'GET', undefined, record.applicant), accept })
      if (!active.current) return
      // A background GET can finish between the recovery decision and its application.
      const known = queryClient.getQueryData<SubmissionData>(key)
      if (recovery.unknown && known && !canEdit(known.change)) { accept(known); return }
      setUnknown(recovery.unknown); setError(recovery.error)
      if (recovery.refreshReviewers) void reviewers.refetch()
    } finally { flight.current = false; if (active.current) setBusy(false) }
  }
  const queryResult = async () => {
    if (flight.current) return
    flight.current = true; setBusy(true)
    try {
      const result = checkedSubmission(await api<unknown>(path, 'GET', undefined, record.applicant), record)
      const latest = accept(result)
      if (!active.current) return
      if (unknown && submissionConfirmed(latest, record, unknown)) { setUnknown(null); setError(null) }
      else if (canEdit(latest.change)) setError('暂未查到新一轮提交完成；结果仍待确认，请按原请求重试。')
    } catch (failure) { if (active.current) setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { flight.current = false; if (active.current) setBusy(false) }
  }
  const arrangementLocked = !!submission.data?.review_arrangement_locked
  const validation = submissionError(current, mode, ids, reviewers.data ?? [], reviewDraftDirty) || submission.data?.issue_blockers?.join(' ')
  const disabled = locked || busy || !!unknown || !!confirm || leaving
  const leaveDisabled = busy || unresolved || !!confirm || leaving
  const prepared = () => {
    if (disabled || !submission.data || !reviewers.data) return
    if (validation) { setError(validation); return }
    setConfirm({ review_mode: mode as SubmissionPayload['review_mode'], reviewer_ids: mode === 'designated' ? [...ids] : [], expected_round: current.current_review_round ?? 0, request_id: crypto.randomUUID() })
  }
  return <>
    <div className="page-heading"><div><span className="eyebrow">申请 #{record.id}</span><h1>提交审核 {locked && <Tag color="gold">{current.status === 'approved' ? '已批准' : '待审批'}</Tag>}</h1><p className="muted">提交后锁定全部表单、审核方式及指定名单。</p></div><Button disabled={leaveDisabled} onClick={onBack}>返回我的申请</Button></div>
    {submission.error && <Alert type="error" title="提交信息读取失败" description={submission.error.message} className="form-alert" action={<Button disabled={busy} onClick={() => void submission.refetch()}>重试</Button>} />}
    {!submission.data ? submission.isPending && <Spin tip="正在读取提交信息…"><div className="loading-space" /></Spin> : <section className="panel list-panel">
      <Descriptions column={1} items={[{ key: 'title', label: '标题', children: current.title || '未填写' }, { key: 'ecr', label: 'ECR 编号', children: current.ecr_no || '未填写' }, { key: 'eco', label: 'ECO 编号', children: current.eco_no || '未填写' }]} />
      {locked ? <>
        <Alert type="info" title={current.status === 'approved' ? '申请已批准，表单与审核意见只读。' : '申请已锁定，等待本轮审核；可从悬浮入口查看审核意见和过程。'} className="form-alert" />
        <Descriptions column={1} items={[
          { key: 'mode', label: '审核方式', children: modeLabel(current.review_mode) },
          { key: 'people', label: '指定审核员', children: current.review_mode === 'designated' ? submission.data.reviewers.map((person) => `${person.display_name}（${person.username}）`).join('、') : '不指定人员' },
          { key: 'time', label: '提交时间', children: current.submitted_at ? new Date(current.submitted_at).toLocaleString('zh-CN', { hour12: false }) : '既有锁定记录未记录提交信息' },
        ]} />
      </> : <>
        {current.status === 'returned' && <Alert type="warning" title="申请已退回，可修改八张表并再次提交。新一轮重新计算批准，上一轮记录保留。" className="form-alert" />}
        {arrangementLocked && <Alert type="info" title="存在未解决意见，重提须沿用原审核方式与指定名单。" className="form-alert" />}
        <h2>审核方式</h2>
        <Radio.Group aria-label="审核方式" disabled={disabled || arrangementLocked} value={mode} onChange={(event) => { choiceEdited.current = true; setMode(event.target.value); setIds([]); setError(null) }} options={[{ value: 'designated', label: '指定审核' }, { value: 'public', label: '公开审核' }]} />
        <p className="muted">指定审核：至少选择一名审核员，所选人员全部批准后通过。公开审核：两名不同审核员批准后通过。</p>
        {reviewers.error && <Alert type="error" title="审核员名单读取失败" description={reviewers.error.message} action={<Button disabled={busy} onClick={() => void reviewers.refetch()}>重试</Button>} className="form-alert" />}
        {mode === 'designated' && <Select aria-label="指定审核员" mode="multiple" disabled={disabled || arrangementLocked || !reviewers.data} loading={reviewers.isFetching} style={{ width: '100%' }} value={ids} placeholder="至少选择一名审核员" optionFilterProp="label" options={reviewers.data?.map((person) => ({ value: person.id, label: `${person.display_name}（${person.username}）` }))} onChange={(next) => { choiceEdited.current = true; setIds(next); setError(null) }} />}
        {validation && <Alert type="warning" title={validation} className="form-alert" />}
        <p className="muted">{arrangementLocked ? '当前沿用原轮次已保存的审核安排。' : '审核方式与人员只保留在当前页面，正式提交时才保存；离开后需重新选择。'}</p>
        {unknown && <Alert type="warning" title="提交结果未确认" description="暂时不能返回填写或改变原提交选择。查询结果或按原请求重试，避免重复或冲突提交。" className="form-alert" />}
      </>}
      {error && <Alert type="error" title={error} className="form-alert" />}
      <div className="form-footer"><Button disabled={leaveDisabled} onClick={onPrevious}>上一页</Button><div className="form-actions">
        <Button disabled={busy || !!confirm} onClick={onReauthenticate}>重新登录</Button>
        {unknown && !locked ? <><Button loading={busy} disabled={busy || leaving} onClick={() => void queryResult()}>查询提交结果</Button><Button type="primary" disabled={busy || leaving} onClick={() => void send(unknown)}>按原请求重试</Button></> : !locked && <Button type="primary" disabled={disabled || !!validation || !reviewers.data} onClick={prepared}>提交申请</Button>}
      </div></div>
    </section>}
    <Modal open={!!confirm} title="确认提交申请？" okText="确认提交并锁定" cancelText="继续检查" onCancel={() => setConfirm(null)} onOk={() => { if (confirm) void send(confirm) }}>
      <p>标题：{current.title}</p><p>ECR：{current.ecr_no}</p><p>ECO：{current.eco_no || '未填写'}</p><p>审核方式：{confirm && modeLabel(confirm.review_mode)}</p>
      {confirm?.review_mode === 'designated' && <p>审核员：{reviewers.data?.filter((person) => confirm.reviewer_ids.includes(person.id)).map((person) => `${person.display_name}（${person.username}）`).join('、')}</p>}
      <p>提交后全部表单、审核方式和指定名单不能修改。</p>
    </Modal>
  </>
}
