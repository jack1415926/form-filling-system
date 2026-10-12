import { useEffect, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Alert, Button, Empty, Table, Tabs, Tag } from 'antd'
import { api, type ChangeRequest, type User } from './api'
import { type RoundInfo, reviewStateLabels } from './review'
import { modeLabel } from './submission'
import ReviewPanel from './ReviewPanel'

export default function ReviewWorkbench({ user, target: selected, onSelect: setSelected, leaving, onReauthenticate, renderForm, onBusy, onDirty }: { user: User; target: { id: number; number: number; showIssues?: boolean } | null; onSelect: (target: { id: number; number: number; showIssues?: boolean } | null) => void; leaving: boolean; onReauthenticate: () => void; renderForm: (record: ChangeRequest, onBack: () => void, state: { onBusy: (value: boolean) => void; onDirty: (value: boolean) => void; leaving: boolean }) => ReactNode; onBusy: (value: boolean) => void; onDirty: (value: boolean) => void }) {
  const [kind, setKind] = useState('designated')
  const [issueBusy, setIssueBusy] = useState(false), [issueDirty, setIssueDirty] = useState(false)
  const [formBusy, setFormBusy] = useState(false), [formDirty, setFormDirty] = useState(false)
  const busy = issueBusy || formBusy, dirty = issueDirty || formDirty
  useEffect(() => { onBusy(busy); onDirty(dirty) }, [busy, dirty, onBusy, onDirty])
  useEffect(() => () => { onBusy(false); onDirty(false) }, [onBusy, onDirty])
  const publicationKind = kind === 'to-publish' || kind === 'published'
  const publications = useQuery({ queryKey: ['publications', user.id, kind], enabled: !selected && publicationKind, refetchOnWindowFocus: false, queryFn: () => api<ChangeRequest[]>(`/api/publications/?state=${kind === 'published' ? 'published' : 'approved'}`, 'GET', undefined, user.id) })
  const list = useQuery({ queryKey: ['review-list', user.id, kind], enabled: !selected && !publicationKind, refetchOnWindowFocus: false, queryFn: () => api<(RoundInfo & { change_id: number })[]>(`/api/review/?kind=${kind}`, 'GET', undefined, user.id) })
  const back = () => { if (busy || leaving) return; if (dirty && !window.confirm('尚未保存的任务填写或审核意见会丢失，确定返回列表？')) return; setSelected(null); setIssueDirty(false); setFormDirty(false) }
  return <>
    {selected ? <ReviewPanel key={`${selected.id}:${selected.number}`} initialOpen={selected.showIssues} changeId={selected.id} number={selected.number} leaving={leaving || formBusy} onReauthenticate={onReauthenticate} onBack={back} onBusy={setIssueBusy} onDirty={setIssueDirty} renderForm={(record) => renderForm(record, back, { onBusy: setFormBusy, onDirty: setFormDirty, leaving: leaving || issueBusy })} /> : <>
      <div className="page-heading"><h1>待我处理</h1><Button loading={list.isFetching} onClick={() => void (publicationKind ? publications.refetch() : list.refetch())}>刷新列表</Button></div>
      <Tabs activeKey={kind} onChange={setKind} items={[{ key: 'designated', label: '指定给我的任务' }, { key: 'returned', label: '退回沟通' }, { key: 'handled', label: '我的已处理记录' }, { key: 'to-publish', label: '待我发布' }, { key: 'published', label: '已发布' }]} />
      {publicationKind ? <>
        {publications.error && <Alert type="error" title={publications.error.message} />}
        <section className="panel list-panel"><Table rowKey="id" loading={publications.isPending} dataSource={publications.data ?? []} columns={[
          { title: '标题', dataIndex: 'title' }, { title: '阶段／编号', render: (_, row) => `${row.stage?.toUpperCase()} · ${row.stage === 'eco' ? row.eco_no : row.ecr_no}` }, { title: '状态', render: (_, row) => row.status === 'published' ? '已发布' : '已批准待发布' },
          { title: '操作', render: (_, row) => <Button disabled={busy} onClick={() => setSelected({ id: row.id, number: row.current_review_round })}>查看申请</Button> },
        ]} /></section>
      </> : <>
      {list.error && <Alert type="error" title={list.error.message} className="form-alert" />}
      <section className="panel list-panel"><Table rowKey={(row) => `${row.change_id}:${row.number}`} loading={list.isPending} dataSource={list.data ?? []} pagination={{ pageSize: 10 }} locale={{ emptyText: <Empty description="暂无记录" /> }} columns={[
        { title: '提交时标题', dataIndex: 'title' }, { title: 'ECR／ECO', render: (_, row) => `${row.ecr_no}／${row.eco_no || '未填写'}` },
        { title: '轮次', dataIndex: 'number' }, { title: '审核方式', render: (_, row) => modeLabel(row.review_mode) }, { title: '状态', render: (_, row) => <Tag>{reviewStateLabels[row.state]}</Tag> },
        { title: '操作', render: (_, row) => <Button disabled={busy} onClick={() => setSelected({ id: row.change_id, number: row.number })}>查看申请</Button> },
      ]} /></section>
      </>}
    </>}
  </>
}
