import { useQuery } from '@tanstack/react-query'
import { Alert, Button, Empty, Select, Space, Table, Tabs, Tag } from 'antd'
import { api, type User } from './api'
import { checkedEngineering, processStates, type EngineeringChange, type ProcessFilter } from './engineeringChangeData'
import type { StageSummary } from './stageNavigationData'
import TestCaseGenerator from './TestCaseGenerator'

export default function EngineeringChanges({ user, workflow, state, onWorkflow, onState, busy, creating, removing, onOpen, onCreate, onDelete }: {
  user: User; workflow: ProcessFilter; state: string; onWorkflow: (value: ProcessFilter) => void; onState: (value: string) => void; busy: boolean; creating: boolean; removing?: number; onOpen: (id: number) => void; onCreate: () => void; onDelete: (row: EngineeringChange) => void
}) {
  const stage = workflow === 'eco' ? 'eco' : 'ecr'
  const query = useQuery({ queryKey: ['changes', user.id, 'engineering', stage, state], refetchOnWindowFocus: true,
    queryFn: async () => checkedEngineering(await api(`/api/engineering-changes/?workflow=${stage}&state=${state}`, 'GET', undefined, user.id), user.id) })
  const summary = (item: StageSummary) => item.status === 'unavailable' ? <span className="muted">无正文权限</span> : item.status === 'not_created' ? <span className="muted">尚未启动</span> : <div className="engineering-process"><strong>{item.number || '编号待填写'}</strong><Tag color={item.status === 'published' ? 'blue' : item.status === 'approved' ? 'green' : item.status === 'returned' ? 'orange' : 'default'}>{processStates[item.status]}{item.status === 'published' && ' · 本流程已完成'}</Tag>{!item.can_open && <span className="muted">来源摘要，只读</span>}</div>
  return <>
    <div className="page-heading"><div><span className="eyebrow">设计变更工作台</span><h1>工程变更</h1><p className="muted">分别查看ECR和ECO，各自填写、审核及发布。</p></div><Space wrap>{user.can_generate_test_data && <TestCaseGenerator key={user.id} user={user} disabled={busy} onOpen={onOpen} />}{stage === 'ecr' && <Button type="primary" size="large" disabled={busy} loading={creating} onClick={onCreate}>＋ 新建ECR</Button>}</Space></div>
    <section className="panel list-panel">
      <Tabs activeKey={stage} onChange={key => onWorkflow(key as 'ecr' | 'eco')} items={[{ key: 'ecr', label: 'ECR流程', disabled: busy }, { key: 'eco', label: 'ECO流程', disabled: busy }]} />
      <div className="section-heading engineering-filters"><label>状态 <Select aria-label="状态筛选" value={state} disabled={busy} onChange={onState} style={{ width: 145 }} options={[{ value: 'all', label: '全部状态' }, ...Object.entries(processStates).map(([value, label]) => ({ value, label }))]} /></label><Button disabled={busy} loading={query.isFetching} onClick={() => void query.refetch()}>刷新列表</Button></div>
      {query.error && <Alert type="error" title={query.error.message} className="form-alert" />}
      <Table<EngineeringChange> rowKey="id" loading={query.isPending} dataSource={(query.data?.items ?? []).filter(row => row[stage].can_open)} scroll={{ x: 850 }} pagination={{ pageSize: 10, hideOnSinglePage: true }} locale={{ emptyText: <Empty description={`当前条件下没有可访问的${stage.toUpperCase()}流程`} /> }} columns={[
        { title: '工程变更', dataIndex: 'title', render: (title: string) => <strong>{title || '未命名工程变更'}</strong> },
        { title: `${stage.toUpperCase()}流程`, render: (_, row) => summary(row[stage]) },
        ...(stage === 'eco' ? [{ title: '来源ECR编号', render: (_: unknown, row: EngineeringChange) => row.ecr.number || '未获取来源编号' }] : []),
        { title: '操作', render: (_, row) => <Space wrap><Button disabled={busy} onClick={() => onOpen(row[stage].id!)}>打开{stage.toUpperCase()}</Button>{stage === 'ecr' && row.can_create_eco && <Button type="primary" disabled={busy} onClick={() => onOpen(row.ecr.id!)}>启动ECO</Button>}{stage === 'ecr' && row.can_delete_ecr && <Button danger disabled={busy} loading={removing === row.id} onClick={() => onDelete(row)}>删除整项工程变更</Button>}</Space> },
      ]} />
    </section>
  </>
}
