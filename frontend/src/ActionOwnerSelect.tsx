import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Select } from 'antd'
import { api, type ActionOwner } from './api'
import { checkedReviewers } from './submission'
import { actorUser } from './workflow'
import { actionOwnerLabel } from './actionOwners'

export default function ActionOwnerSelect({ id, value, linked, legacy, disabled, onChange }: {
  id: string; value: string | null; linked: ActionOwner | null; legacy: string; disabled: boolean; onChange: (value: string | null) => void
}) {
  const client = useQueryClient(), user = actorUser(client)
  const people = useQuery({ queryKey: ['action-owners', user.id], enabled: !disabled, refetchOnWindowFocus: false,
    queryFn: async () => checkedReviewers(await api<unknown>('/api/action-owners/', 'GET', undefined, user.id)) })
  const options = (people.data ?? []).map(person => ({ value: String(person.id), label: `${person.display_name}（${person.username}）`, disabled: false }))
  if (linked) {
    const option = { value: String(linked.id), label: actionOwnerLabel(linked), disabled: !linked.is_active }
    const index = options.findIndex(candidate => candidate.value === option.value)
    if (index < 0) options.push(option); else options[index] = option
  }
  return <>
    <label htmlFor={id}>负责人用户</label><Select id={id} aria-label="负责人用户" style={{ width: '100%' }} value={value ?? undefined} disabled={disabled} loading={people.isFetching} allowClear showSearch optionFilterProp="label" placeholder="尚未关联用户" options={options} onChange={next => onChange(next ?? null)} />
    {people.error && <Alert type="error" title="负责人名单读取失败" description={people.error.message} action={<Button onClick={() => void people.refetch()}>重试</Button>} />}
    <label>原负责人文字</label><p className="question-text muted">{legacy || '无'}</p>
  </>
}
