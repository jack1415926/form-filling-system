import { useMemo, useState } from 'react'
import { QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Descriptions, Spin, Table, Tabs } from 'antd'
import { api } from './api'
import { actorUser } from './workflow'
import { adjacentSnapshotTab, checkedSnapshot, snapshotClient, snapshotPath, type SnapshotData } from './roundSnapshots'
import MaterialEditor from './MaterialEditor'
import QuestionEditor from './QuestionEditor'
import EcrEditor from './EcrEditor'
import EcoEditor from './EcoEditor'
import InactiveEcoSheet from './InactiveEcoSheet'
import EmcEditor from './EmcEditor'
import ExecutionPlanEditor from './ExecutionPlanEditor'
import SignificantChangeEditor from './SignificantChangeEditor'

const noop = () => {}
const overviewLabels: Record<string, string> = { title: '标题', ecr_no: 'ECR编号', eco_no: 'ECO编号', affected_products: '受影响产品', affected_region: '受影响区域', initiating_factory: '发起工厂', affected_factories: '受影响工厂', ccb_owner: 'CCB负责人', change_owner: '变更负责人', planned_eco_date: '计划ECO日期', change_reason: '变更原因' }

function FrozenForm({ data }: { data: SnapshotData }) {
  const user = actorUser(useQueryClient())
  // Keep seeded data through StrictMode's effect replay; this client is local to the mounted snapshot.
  const client = useMemo(() => snapshotClient(data, user), [data, user])
  const [tab, setTab] = useState('overview')
  const snapshot = data.snapshot!, record = snapshot.overview
  const props = { record, leaving: false, onDirty: noop, onBusy: noop, onBack: noop, onReauthenticate: noop, onEditorOpen: noop,
    onPrevious: () => setTab(adjacentSnapshotTab(tab, -1)), onNext: () => setTab(adjacentSnapshotTab(tab, 1)), onSaved: noop }
  const overview = <Descriptions column={2} items={Object.entries(overviewLabels).map(([key, label]) => ({ key, label: key === 'ecr_no' && record.stage === 'eco' ? '来源ECR编号' : label,
    children: <span className="question-text">{String(key === 'ecr_no' && record.stage === 'eco' ? record.source_ecr_no ?? '' : record[key as keyof typeof record] ?? '') || '未填写'}</span> }))} />
  return <QueryClientProvider client={client}>
    <Alert className="form-alert" type="info" title={`第${data.number}轮提交的完整表单 · 只读`} description={`正文保存于 ${new Date(snapshot.captured_at).toLocaleString('zh-CN')}；行动处理结果来自本轮记录，不展示修订中的新内容。`} />
    {!!data.tasks.length && <><h3>本轮逐人处理结果</h3><Table rowKey="id" pagination={false} dataSource={data.tasks} columns={[
      { title: '行动', dataIndex: 'action_key' }, { title: '负责人', dataIndex: 'owner_name' },
      { title: '处理结果', dataIndex: 'result', render: text => <p className="question-text">{text || '尚未填写'}</p> },
      { title: '状态', render: (_, task) => `${task.status === 'completed' ? '已完成' : task.status === 'not_applicable' ? '不适用' : task.status === 'implementation_stage' ? '在实施阶段完成' : '未填写'} · ${task.confirmed_at ? '已确认' : '未确认'}` },
      { title: '业务日期', dataIndex: 'date' },
    ]} /></>}
    <Tabs activeKey={tab} onChange={setTab} destroyOnHidden items={[
      { key: 'overview', label: '概述', children: overview },
      { key: 'materials', label: '物料与处置', children: <MaterialEditor {...props} /> },
      { key: 'questions', label: '问题评估', children: <QuestionEditor {...props} /> },
      { key: 'ecr', label: record.stage === 'eco' ? '来源ECR评估' : 'ECR评估行动', children: <>{snapshot.source_overview && <Descriptions column={2} items={Object.entries(snapshot.source_overview).map(([key, value]) => ({ key, label: overviewLabels[key] ?? key, children: value || '未填写' }))} />}<EcrEditor {...props} /></> },
      { key: 'eco', label: record.stage === 'ecr' ? 'ECO行动模板' : 'ECO执行行动', children: record.stage === 'ecr' ? <InactiveEcoSheet {...props} /> : <EcoEditor {...props} /> },
      { key: 'emc', label: 'EMC参考', children: <EmcEditor {...props} /> },
      { key: 'execution-plan', label: '执行计划', children: <ExecutionPlanEditor {...props} /> },
      { key: 'significant-change', label: '实质性评估', children: <SignificantChangeEditor {...props} /> },
    ]} />
    {(tab === 'overview' || tab === 'eco' && record.stage === 'ecr') && <div className="form-footer">
      {tab !== 'overview' && <Button onClick={props.onPrevious}>上一页</Button>}<Button onClick={props.onNext}>下一页</Button>
    </div>}
  </QueryClientProvider>
}

export default function RoundSnapshotForm({ changeId, number, expanded = false }: { changeId: number; number: number; expanded?: boolean }) {
  const user = actorUser(useQueryClient())
  const [open, setOpen] = useState(expanded)
  const query = useQuery({ queryKey: ['round-form-snapshot', user.id, changeId, number], enabled: open, refetchOnWindowFocus: false,
    queryFn: async () => checkedSnapshot(await api<unknown>(snapshotPath(changeId, number), 'GET', undefined, user.id), user.id, changeId, number) })
  return <section className="panel list-panel material-section">
    <Button onClick={() => setOpen(!open)}>{open ? '收起本轮完整表单' : '查看本轮提交的完整表单（只读）'}</Button>
    {open && <>{query.isPending && <Spin />}{query.error && <Alert type="error" title={query.error.message} action={<Button onClick={() => void query.refetch()}>重试</Button>} />}
      {query.data && (query.data.snapshot ? <FrozenForm data={query.data} /> : <Alert className="form-alert" type="info" title="本轮未保存完整历史表单" description="该轮次产生于历史快照功能启用前，仍可查看任务结果和审核意见；当前正文不会被当作历史版本。" />)}</>}
  </section>
}
