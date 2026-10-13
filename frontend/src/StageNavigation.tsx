import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Descriptions, Space, Steps } from 'antd'
import { api, ApiError, type ChangeRequest, type User } from './api'
import { checkedNavigation, newestNavigation, stageSteps, currentStageIndex, type NavigationData } from './stageNavigationData'

export default function StageNavigation({ record, leaving, onOpenChange }: { record: ChangeRequest; leaving: boolean; onOpenChange?: (id: number) => void }) {
  const client = useQueryClient(), actor = client.getQueryData<User>(['me'])!.id
  const key = ['stage-navigation', actor, record.id]
  const query = useQuery({ queryKey: key, refetchOnWindowFocus: false, queryFn: async () => {
    const data = checkedNavigation(await api(`/api/changes/${record.id}/stage-navigation/`, 'GET', undefined, actor), record.id, actor)
    return newestNavigation(client.getQueryData<NavigationData>(key), data)
  } })
  return <section className="panel form-alert">
    <h2>{query.data?.stages[1].status === 'published' ? 'ECR至ECO流程已完成' : '阶段进度'}</h2>
    {query.error && <Alert type="error" title={query.error.message} action={<Button disabled={leaving} onClick={() => void query.refetch()}>刷新进度</Button>} />}
    <Steps size="small" current={currentStageIndex(record)} items={query.data?.stages.flatMap(stageSteps) ?? []} />
    <Space wrap>{query.data?.stages.map(stage => <span key={stage.stage}>
      {stage.can_open && stage.id !== record.id && onOpenChange ? <Button disabled={leaving} onClick={() => onOpenChange(stage.id!)}>打开{stage.stage.toUpperCase()} {stage.number}</Button> : stage.number && <span>{stage.stage.toUpperCase()}：{stage.number}</span>}
      {stage.published_at && <span> · 发布于{new Date(stage.published_at).toLocaleString('zh-CN')}</span>}
    </span>)}</Space>
  </section>
}

const overviewLabels = { title: '标题', affected_products: '产品和型号', affected_region: '受影响区域', initiating_factory: '发起工厂', affected_factories: '受影响工厂', ccb_owner: 'CCB负责人', change_owner: '变更发起人', planned_eco_date: '计划完成日期', change_reason: '变更原因' }
type SourceData = { actor_id: number; eco_id: number; source_ecr_id: number; ecr_no: string; published_at: string; can_open: boolean; overview: Record<keyof typeof overviewLabels, string | null> }

export function SourceOverview({ record }: { record: ChangeRequest }) {
  const client = useQueryClient(), actor = client.getQueryData<User>(['me'])!.id
  const query = useQuery({ queryKey: ['source-ecr', actor, record.id], refetchOnWindowFocus: false, queryFn: async () => {
    const value = await api<SourceData>(`/api/changes/${record.id}/source-ecr/`, 'GET', undefined, actor)
    if (!value || value.actor_id !== actor || value.eco_id !== record.id || value.source_ecr_id !== record.source_ecr_id || typeof value.ecr_no !== 'string' || typeof value.can_open !== 'boolean'
      || typeof value.published_at !== 'string' || !Number.isFinite(Date.parse(value.published_at)) || !value.overview
      || !Object.keys(overviewLabels).every(key => typeof value.overview[key as keyof typeof overviewLabels] === 'string' || key === 'planned_eco_date' && value.overview.planned_eco_date === null)) throw new ApiError(200, '来源发布概述响应不完整。')
    return value
  } })
  return <section className="panel form-alert"><h2>来源ECR发布概述（只读）</h2>
    {query.error && <Alert type="error" title={query.error.message} action={<Button onClick={() => void query.refetch()}>重试读取来源</Button>} />}
    {query.data && <><p>ECR：{query.data.ecr_no} · 发布于{new Date(query.data.published_at).toLocaleString('zh-CN')}</p>
      <Descriptions size="small" column={2} items={Object.entries(overviewLabels).map(([key, label]) => ({ key, label, children: query.data!.overview[key as keyof typeof overviewLabels] || '—' }))} />
    </>}
  </section>
}
