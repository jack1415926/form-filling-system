import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Drawer, Table, Tag } from 'antd'
import { api, type User } from './api'
import FeedbackLauncher from './FeedbackLauncher'
import { hasReviewDrawer, getReviewDrawerCount, openReviewDrawer, requestFeedbackDrawer, subscribeReviewDrawer } from './systemFeedback'
import { checkedInbox, inboxNavigationEvent, type InboxItem, type InboxNavigation } from './reviewInboxData'

export default function ReviewInbox({ user, leaving, onSystem, systemCount = 0 }: { user: User; leaving: boolean; onSystem: () => void; systemCount?: number }) {
  const client = useQueryClient(), { modal, message } = App.useApp()
  const [open, setOpen] = useState(false)
  const currentAvailable = useSyncExternalStore(subscribeReviewDrawer, hasReviewDrawer)
  const currentCount = useSyncExternalStore(subscribeReviewDrawer, getReviewDrawerCount)
  const prompted = useRef(false), intro = useRef<ReturnType<typeof modal.confirm> | null>(null)
  const query = useQuery({ queryKey: ['review-inbox', user.id, user.role], refetchInterval: 30_000,
    queryFn: async () => checkedInbox(await api<unknown>('/api/review/inbox/', 'GET', undefined, user.id), user) })
  const markRead = useMutation({
    mutationFn: async (items: InboxItem[]) => checkedInbox(await api<unknown>('/api/review/inbox/read/', 'POST', {
      items: items.map(({ change_id, round, message_key }) => ({ change_id, round, message_key })),
    }, user.id), user),
    onSuccess: async () => {
      // Re-read authoritative state; a delayed POST response must not hide a newer message.
      const refreshed = await query.refetch()
      if (client.getQueryData<User>(['me'])?.id === user.id) {
        if (refreshed.isError) message.warning('已读已保存，但列表刷新失败，请重试刷新消息。')
        else message.success('已标为已读，审核事项仍保留。')
      }
    },
    onError: () => { void query.refetch() },
  })
  const openInbox = () => requestFeedbackDrawer('inbox', () => setOpen(true))
  useEffect(() => {
    if (!prompted.current && query.data?.unread_count && client.getQueryData<User>(['me'])?.id === user.id) {
      prompted.current = true
      intro.current = modal.confirm({ title: `你有 ${query.data.unread_count} 项未读审核消息`,
        content: `涉及 ${query.data.items.filter(item => !item.is_read).length} 份申请，包含审核意见、填写员回应及待审核申请。稍后处理不会清除提醒。`,
        okText: '查看消息', cancelText: '稍后处理', onOk: () => requestFeedbackDrawer('inbox', () => setOpen(true)) })
    }
  }, [query.data, client, user.id, modal])
  useEffect(() => () => { intro.current?.destroy() }, [])
  useEffect(() => {
    const switchDrawer = (event: Event) => {
      const request = event as CustomEvent<{ kind: string; open: () => void }>
      if (open && request.detail.kind !== 'inbox') { request.preventDefault(); setOpen(false); request.detail.open() }
    }
    window.addEventListener('feedback-drawer-request', switchDrawer)
    return () => window.removeEventListener('feedback-drawer-request', switchDrawer)
  }, [open])
  const navigate = (item: InboxItem) => {
    if (leaving) return
    window.dispatchEvent(new CustomEvent<InboxNavigation>(inboxNavigationEvent, {
      detail: { actor_id: user.id, item, onOpened: () => setOpen(false) },
    }))
  }
  return <>
    <FeedbackLauncher reviewAvailable reviewCount={query.data?.unread_count ?? 0} systemCount={systemCount} onSystem={onSystem} onReview={openInbox} />
    <Drawer title={`审核消息 · 未读 ${query.data?.unread_count ?? '…'} / 待处理 ${query.data?.count ?? '…'}`} open={open} onClose={() => setOpen(false)} size={680}
      extra={currentAvailable && <Button disabled={leaving} onClick={openReviewDrawer}>当前申请意见（{currentCount}）</Button>}>
      <p className="muted">红点表示未读消息。标为已读只清除提醒，不会批准申请、提交回应或删除待处理事项。</p>
      <div className="form-actions"><Button loading={query.isFetching} onClick={() => void query.refetch()}>刷新消息</Button>
        <Button disabled={leaving || markRead.isPending || !query.data?.unread_count} loading={markRead.isPending}
          onClick={() => markRead.mutate(query.data!.items.filter(item => !item.is_read))}>全部标为已读</Button></div>
      {markRead.error && <Alert type="error" title="已读标记未确认，请刷新消息后重试" description={markRead.error.message} className="form-alert" />}
      {query.error && <Alert type="error" title="审核消息读取失败" description={query.error.message} className="form-alert" />}
      <Table<InboxItem> rowKey="change_id" loading={query.isPending} dataSource={query.data?.items ?? []} pagination={{ pageSize: 10 }}
        locale={{ emptyText: '暂无需要你处理的审核事项' }} columns={[
          { title: '申请', render: (_, item) => <div>{item.title || '未命名申请'}<p className="muted">{item.ecr_no || '未填写编号'} · 第{item.round}轮</p></div> },
          { title: '消息', dataIndex: 'summary' },
          { title: '阅读状态', render: (_, item) => <Tag color={item.is_read ? undefined : 'red'}>{item.is_read ? '已读' : '未读'}</Tag> },
          { title: '操作', render: (_, item) => <div className="form-actions"><Button disabled={leaving} onClick={() => navigate(item)}>查看并处理</Button>
            {!item.is_read && <Button disabled={leaving || markRead.isPending} onClick={() => markRead.mutate([item])}>标为已读</Button>}</div> },
        ]} />
    </Drawer>
  </>
}
