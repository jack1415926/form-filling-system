import { useMutation, useQuery } from '@tanstack/react-query'
import { Alert, App, Button, Space, Tag } from 'antd'
import { api, ApiError, type User } from './api'
import { processStates } from './engineeringChangeData'

type Notice = { event_id: number; change_id: number; title: string; eco_no: string; source_ecr_no: string; kind: 'create' | 'transfer'; actor_name: string; status: keyof typeof processStates }
type Inbox = { actor_id: number; unread_count: number; items: Notice[] }

export default function EcoFillerInbox({ user, blocked, onOpen }: { user: User; blocked: boolean; onOpen: (id: number) => void }) {
  const { message } = App.useApp()
  const query = useQuery({ queryKey: ['eco-filler-inbox', user.id], refetchInterval: 30_000, queryFn: async () => {
    const data = await api<Inbox>('/api/eco-filler/inbox/', 'GET', undefined, user.id)
    if (data.actor_id !== user.id || !Array.isArray(data.items) || data.unread_count !== data.items.length
      || new Set(data.items.map(item => item.event_id)).size !== data.items.length
      || !data.items.every(item => item && Number.isSafeInteger(item.event_id) && item.event_id > 0 && Number.isSafeInteger(item.change_id) && item.change_id > 0
        && ['title', 'eco_no', 'source_ecr_no', 'actor_name'].every(key => typeof item[key as keyof Notice] === 'string')
        && ['create', 'transfer'].includes(item.kind) && Object.hasOwn(processStates, item.status))) throw new ApiError(200, 'ECO填写提醒响应不完整，请重试。')
    return data
  } })
  const read = useMutation({ mutationFn: (event_id: number) => api('/api/eco-filler/inbox/read/', 'POST', { event_id }, user.id),
    onSuccess: () => { void query.refetch() }, onError: error => { message.warning(error.message); void query.refetch() } })
  if (query.error) return <Alert className="form-alert" type="warning" title="ECO填写提醒读取失败" action={<Button onClick={() => void query.refetch()}>重试提醒</Button>} />
  if (!query.data?.unread_count) return null
  return <Alert className="form-alert" type="info" showIcon title="你获得ECO填写权限" description={<div>{query.data.items.map(item => <div key={item.event_id}>
    <Space wrap><span>{item.actor_name}{item.kind === 'create' ? '创建并指定你填写' : '向你交接'}：{item.eco_no || item.title || '编号待填写'} · 来源ECR：{item.source_ecr_no}</span><Tag>{processStates[item.status]}</Tag>
      <Button disabled={blocked} onClick={() => onOpen(item.change_id)}>打开ECO填写</Button><Button disabled={blocked || read.isPending} onClick={() => read.mutate(item.event_id)}>标为已读</Button>
    </Space></div>)}</div>} />
}
