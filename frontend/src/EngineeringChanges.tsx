import { useQuery } from '@tanstack/react-query'
import { Alert, Button, Empty, Select, Space, Table, Tag } from 'antd'
import { api, type User } from './api'
import { checkedEngineering, processStates, type EngineeringChange, type ProcessFilter } from './engineeringChangeData'
import type { StageSummary } from './stageNavigationData'

export default function EngineeringChanges({ user, workflow, state, onWorkflow, onState, busy, creating, removing, onOpen, onCreate, onDelete }: {
  user: User; workflow: ProcessFilter; state: string; onWorkflow: (value: ProcessFilter) => void; onState: (value: string) => void; busy: boolean; creating: boolean; removing?: number; onOpen: (id: number) => void; onCreate: () => void; onDelete: (row: EngineeringChange) => void
}) {
  const query = useQuery({ queryKey: ['changes', user.id, 'engineering', workflow, state], refetchOnWindowFocus: true,
    queryFn: async () => checkedEngineering(await api(`/api/engineering-changes/?workflow=${workflow}&state=${state}`, 'GET', undefined, user.id), user.id) })
  const summary = (item: StageSummary) => item.status === 'unavailable' ? <span className="muted">无正文权限</span> : item.status === 'not_created' ? <span className="muted">尚未启动</span> : <div className="engineering-process"><strong>{item.number || '编号待填写'}</strong><Tag color={item.status === 'published' ? 'blue' : item.status === 'approved' ? 'green' : item.status === 'returned' ? 'orange' : 'default'}>{processStates[item.status]}{item.status === 'published' && ' · 本流程已完成'}</Tag>{!item.can_open && <span className="muted">来源摘要，只读</span>}</div>
  return <>
    <div className="page-heading"><div><span className="eyebrow">设计变更工作台</span><h1>工程变更</h1><p className="muted">关联查看ECR／ECO；两份流程分别填写、审核和发布。</p></div><Button type="primary" size="large" disabled={busy} loading={creating} onClick={onCreate}>＋ 新建ECR</Button></div>
    <section className="panel list-panel"><div className="section-heading engineering-filters"><Space wrap><label>流程 <Select aria-label="流程筛选" value={workflow} disabled={busy} onChange={onWorkflow} style={{ width: 145 }} options={[{ value: 'all', label: '全部流程' }, { value: 'ecr', label: 'ECR流程' }, { value: 'eco', label: 'ECO流程' }]} /></label><label>状态 <Select aria-label="状态筛选" value={state} disabled={busy} onChange={onState} style={{ width: 145 }} options={[{ value: 'all', label: '全部状态' }, ...Object.entries(processStates).map(([value, label]) => ({ value, label }))]} /></label></Space><Button disabled={busy} loading={query.isFetching} onClick={() => void query.refetch()}>刷新列表</Button></div>
      <p className="muted">状态条件应用于所选且有正文权限的流程；另一份关联流程同时展示，不获得额外权限。</p>
      {query.error && <Alert type="error" title={query.error.message} className="form-alert" />}
      <Table<EngineeringChange> rowKey="id" loading={query.isPending} dataSource={query.data?.items ?? []} scroll={{ x: 850 }} pagination={{ pageSize: 10, hideOnSinglePage: true }} locale={{ emptyText: <Empty description="当前条件下没有可访问的工程变更" /> }} columns={[
        { title: '工程变更', dataIndex: 'title', render: (title: string) => <strong>{title || '未命名工程变更'}</strong> },
        { title: 'ECR流程', render: (_, row) => summary(row.ecr) }, { title: 'ECO流程', render: (_, row) => summary(row.eco) },
        { title: '操作', render: (_, row) => <Space wrap>{row.ecr.can_open && <Button disabled={busy} onClick={() => onOpen(row.ecr.id!)}>打开ECR</Button>}{row.eco.can_open && <Button disabled={busy} onClick={() => onOpen(row.eco.id!)}>打开ECO</Button>}{row.can_create_eco && <Button type="primary" disabled={busy} onClick={() => onOpen(row.ecr.id!)}>启动ECO</Button>}{row.can_delete_ecr && <Button danger disabled={busy} loading={removing === row.id} onClick={() => onDelete(row)}>删除ECR草稿</Button>}</Space> },
      ]} />
    </section>
  </>
}
