import { useEffect, useState } from 'react'
import { Alert, Button, Drawer, Select, Table } from 'antd'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type ChangeRequest, type EcoAction, type EcoData } from './api'
import { actorUser } from './workflow'
import { checkedActionData } from './actionOwners'
import { newestResponse } from './latestResponse'

export default function InactiveEcoSheet({ record, leaving, onEditorOpen }: { record: ChangeRequest; leaving: boolean; onEditorOpen: (open: boolean) => void }) {
  const client = useQueryClient(), actor = actorUser(client).id
  const key = ['eco-actions', actor, record.id]
  const [selected, setSelected] = useState<EcoAction | null>(null), [all, setAll] = useState(false)
  const query = useQuery({ queryKey: key, refetchOnWindowFocus: false, queryFn: async () => {
    const incoming = checkedActionData(await api(`/api/changes/${record.id}/eco-actions/`, 'GET', undefined, actor), 'eco')
    return newestResponse(client.getQueryData<EcoData>(key), incoming)
  } })
  const rows = (query.data?.actions ?? []).filter(row => all || row.question_answer === 'Y')
  useEffect(() => { onEditorOpen(!!selected); return () => onEditorOpen(false) }, [selected, onEditorOpen])
  return <section className="panel list-panel"><h1>ECO执行行动 · 本流程只读模板</h1><Alert type="info" className="form-alert" title="本ECR流程保留ECO Sheet供查看，不分配、填写或确认ECO行动。" description="ECR发布后显式启动独立ECO，再进入该ECO处理执行行动。" />
    <div className="section-heading"><Select aria-label="ECO模板显示范围" value={all ? 'all' : 'selected'} disabled={leaving || !!selected} options={[{ value: 'selected', label: '已选问题对应的行动' }, { value: 'all', label: '查看全部模板' }]} onChange={value => setAll(value === 'all')} /><span className="muted">按本ECR已保存的问题答案显示，未选内容收起。</span></div>
    {query.error && <Alert className="form-alert" type="error" title="ECO模板读取失败" description={query.error.message} action={<Button disabled={leaving} onClick={() => void query.refetch()}>重试</Button>} />}
    <Table rowKey="id" dataSource={rows} loading={query.isPending} locale={{ emptyText: query.error ? '读取失败，请重试' : '没有已选问题对应的ECO行动，可查看全部模板。' }} pagination={{ pageSize: 10 }} columns={[{ title: '来源问题', dataIndex: 'number', width: 95 }, { title: '职能', dataIndex: 'function', width: 100 }, { title: 'ECO行动模板', dataIndex: 'text', render: (text: string) => <p className="question-text">{text}</p> }, { title: '操作', render: (_, row) => <Button disabled={leaving || !!selected} onClick={() => setSelected(row)}>查看模板</Button> }]} />
    <Drawer open={!!selected} title="ECO行动模板（只读）" onClose={() => setSelected(null)} size={640}>{selected && <><p>问题{selected.number} · {selected.function}</p><p className="question-text">{selected.text}</p></>}</Drawer>
  </section>
}
