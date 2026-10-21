import { actorUser } from './workflow'
import { newestResponse } from './latestResponse'
import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Drawer, Empty, Select, Table, Tag } from 'antd'
import { api, ApiError, type EcrAction, type EcrData } from './api'
import { actionOwnerLabel, checkedActionData } from './actionOwners'
import { StageActions } from './StageWorkflow'

const statusLabels = { '': '未填写', completed: '完成', not_applicable: '不适用' }
type Props = Parameters<typeof StageActions>[0]
const owners = (action: EcrAction) => action.owner_users.map(actionOwnerLabel).join('、') || '未分配'

// 来源ECR只读，不保留已停用的单负责人编辑器和保存队列。
function ActionDetails({ action }: { action: EcrAction }) {
  return <div className="preview-drawer"><Tag>{action.function}</Tag><p className="question-text">{action.text}</p>
    {action.task_results?.length ? action.task_results.map(task => <section className="material-section" key={task.id}>
      <h3>{actionOwnerLabel(task.owner)}</h3><p className="question-text">{task.result}</p><p>{statusLabels[task.status]} · 业务日期：{task.date}</p>
      <p>第{task.round}轮 · 确认时间：{new Date(task.confirmed_at).toLocaleString('zh-CN')}</p>
    </section>) : <><p>负责人：{owners(action)}</p><p className="question-text">{action.result || '未填写评估结果'}</p><p>{statusLabels[action.status]} · {action.date || '未填日期'}</p></>}
  </div>
}

function SourceEcrEditor({ record, onPrevious, onNext, leaving, onReauthenticate, onEditorOpen }: Props) {
  const queryClient = useQueryClient(), actorId = actorUser(queryClient).id
  const [editor, setEditor] = useState<EcrAction | null>(null), [all, setAll] = useState(false)
  const queryKey = ['ecr-actions', actorId, record.id]
  const actions = useQuery({ queryKey, refetchOnWindowFocus: false, queryFn: async () => {
    const result = checkedActionData(await api<unknown>(`/api/changes/${record.id}/ecr-actions/`, 'GET', undefined, actorId), 'ecr')
    if (record.stage === 'eco' && result.source_ecr_id !== record.source_ecr_id) throw new ApiError(200, '来源ECR响应与当前ECO不一致。')
    return newestResponse(queryClient.getQueryData<EcrData>(queryKey), result)
  } })
  useEffect(() => { onEditorOpen(!!editor); return () => onEditorOpen(false) }, [editor, onEditorOpen])
  const busy = leaving, close = () => { if (!busy) setEditor(null) }
  const rows = (actions.data?.actions ?? []).filter((row) => all || row.question_answer === 'Y' || row.extra_required || !!row.task_results?.length)
  return <>
    <div className="page-heading"><div><span className="eyebrow">申请 #{record.id}</span><h1>ECR 评估行动</h1><p className="muted">默认显示问题触发、手工补充及已有确认结果的行动；其他内容可在全部行动中查看。</p></div></div>
    {actions.error && <Alert type="error" showIcon title={actions.data ? '评估刷新失败，当前内容仍保留' : '无法读取 ECR 评估'} description={actions.error.message} className="form-alert" action={<Button disabled={busy} loading={actions.isFetching} onClick={() => void actions.refetch()}>重试</Button>} />}
    <section className="panel list-panel"><div className="section-heading"><h2>ECR 评估行动</h2><Select aria-label="行动筛选" disabled={busy || !!editor} style={{ width: 190 }} value={all ? 'all' : 'relevant'} options={[{ value: 'relevant', label: '当前触发' }, { value: 'all', label: '全部行动' }]} onChange={(value) => setAll(value === 'all')} /></div>
      <Table<EcrAction> rowKey="id" pagination={false} loading={actions.isPending} dataSource={rows} scroll={{ x: 1035 }} locale={{ emptyText: <Empty description={actions.error ? '读取失败，请重试' : '暂无当前触发的行动，可先保存问题答案或查看全部行动。'} /> }} columns={[
        { title: '来源问题', width: 160, render: (_, row) => <><strong>问题 {row.number}</strong><div className="preview-source"><Tag color={row.question_answer === 'Y' ? 'green' : 'default'}>{row.question_answer === 'Y' ? '当前触发' : row.question_answer === 'N' ? '当前未触发' : '来源问题未回答'}</Tag></div></> },
        { title: '职能', dataIndex: 'function', width: 125 },
        { title: 'ECR 评估行动', dataIndex: 'text', width: 380, render: (text: string) => <div className="question-text">{text}</div> },
        { title: '填写摘要', width: 280, render: (_, row) => <div className="preview-summary">{row.task_results?.length ? row.task_results.map(task => <div key={task.id}><div>{actionOwnerLabel(task.owner)} · {statusLabels[task.status]} · {task.date}</div><p title={task.result}>{task.result.slice(0, 100)}</p></div>) : <><div>{owners(row)} · {statusLabels[row.status]} · {row.date || '未填日期'}</div><p title={row.result}>{row.result ? row.result.slice(0, 100) : '未填写评估结果'}</p></>}</div> },
        { title: '操作', width: 90, render: (_, row) => <Button type="link" disabled={busy || !!editor} onClick={() => setEditor(row)}>查看</Button> },
      ]} />
    </section><div className="form-footer"><span className="muted">未触发时隐藏，不删除已有填写；触发后重新出现。</span><div className="form-actions"><Button disabled={busy || !!editor} onClick={onPrevious}>上一页</Button><Button disabled={busy || !!editor} onClick={onNext}>下一页</Button></div></div>
    <Drawer open={!!editor} size={720} title={editor && `问题 ${editor.number} · ECR 评估`} onClose={close} maskClosable={!busy} keyboard={!busy} closable={!busy} extra={<Button disabled={busy} onClick={onReauthenticate}>重新登录</Button>}>
      {editor && <ActionDetails action={actions.data?.actions.find(row => row.id === editor.id) ?? editor} />}
    </Drawer>
  </>
}

export default function EcrEditor(props: Props) {
  return props.record.stage === 'ecr' ? <StageActions {...props} /> : <SourceEcrEditor {...props} />
}
