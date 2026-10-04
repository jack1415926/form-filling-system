import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Alert, Button, Empty, Table, Tabs, Tag } from 'antd'
import { api, type ChangeRequest, type User } from './api'
import { type RoundInfo, reviewStateLabels } from './review'
import { modeLabel } from './submission'
import ReviewPanel from './ReviewPanel'

export default function ReviewWorkbench({ user, leaving, onReauthenticate, renderForm, onBusy, onDirty }: { user: User; leaving: boolean; onReauthenticate: () => void; renderForm: (record: ChangeRequest, onBack: () => void) => ReactNode; onBusy: (value: boolean) => void; onDirty: (value: boolean) => void }) {
  const [kind, setKind] = useState('designated'), [selected, setSelected] = useState<{ id: number; number: number } | null>(null)
  const [busy, setBusy] = useState(false), [dirty, setDirty] = useState(false)
  const list = useQuery({ queryKey: ['review-list', user.id, kind], enabled: !selected, refetchOnWindowFocus: false, queryFn: () => api<(RoundInfo & { change_id: number })[]>(`/api/review/?kind=${kind}`, 'GET', undefined, user.id) })
  const back = () => { if (busy || leaving) return; if (dirty && !window.confirm('尚未发送的反馈或退回原因会丢失，确定返回列表？')) return; setSelected(null); setDirty(false) }
  return <>
    {selected ? <ReviewPanel key={`${selected.id}:${selected.number}`} changeId={selected.id} number={selected.number} leaving={leaving} onReauthenticate={onReauthenticate} onBack={back} onBusy={(value) => { setBusy(value); onBusy(value) }} onDirty={(value) => { setDirty(value); onDirty(value) }} renderForm={(record) => renderForm(record, back)} /> : <>
      <div className="page-heading"><h1>审核工作台</h1><Button loading={list.isFetching} onClick={() => void list.refetch()}>刷新列表</Button></div>
      <Tabs activeKey={kind} onChange={setKind} items={[{ key: 'designated', label: '指定给我的任务' }, { key: 'public', label: '公开审核' }, { key: 'returned', label: '退回沟通' }, { key: 'handled', label: '我的已处理记录' }]} />
      {list.error && <Alert type="error" title={list.error.message} className="form-alert" />}
      <section className="panel list-panel"><Table rowKey={(row) => `${row.change_id}:${row.number}`} loading={list.isPending} dataSource={list.data ?? []} pagination={{ pageSize: 10 }} locale={{ emptyText: <Empty description="暂无记录" /> }} columns={[
        { title: '提交时标题', dataIndex: 'title' }, { title: 'ECR／ECO', render: (_, row) => `${row.ecr_no}／${row.eco_no || '未填写'}` },
        { title: '轮次', dataIndex: 'number' }, { title: '审核方式', render: (_, row) => modeLabel(row.review_mode) }, { title: '状态', render: (_, row) => <Tag>{reviewStateLabels[row.state]}</Tag> },
        { title: '操作', render: (_, row) => <Button disabled={busy} onClick={() => setSelected({ id: row.change_id, number: row.number })}>查看申请</Button> },
      ]} /></section>
    </>}
  </>
}
