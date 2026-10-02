import { useEffect, useState } from 'react'
import { Alert, App, Button, Drawer, Empty, Input, Select, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { DEMO_QUESTIONS } from './ecrPreviewData'
import { actionPatch, applyActionPatch, EMPTY_ACTION, initialActions, initialAnswers, visibleActions, type ActionDefinition, type ActionValues, type Answer } from './ecrPreviewState'
import './App.css'

const statusLabels = { '': '未填写', completed: '完成', not_applicable: '不适用' }
const statusOptions = Object.entries(statusLabels).map(([value, label]) => ({ value, label }))
const answerOptions = [{ value: '', label: '未回答' }, { value: 'Y', label: '是' }, { value: 'N', label: '否' }]

export default function EcrPreview() {
  const { modal, message } = App.useApp()
  const [all, setAll] = useState(false)
  const [answers, setAnswers] = useState(initialAnswers)
  const [answerDraft, setAnswerDraft] = useState(initialAnswers)
  const [saved, setSaved] = useState(initialActions)
  const [editor, setEditor] = useState<{ action: ActionDefinition; values: ActionValues } | null>(null)
  const patch = actionPatch(saved, editor ? { [editor.action.id]: editor.values } : {})
  const actionDirty = Object.keys(patch).length > 0
  const questionDirty = DEMO_QUESTIONS.some((question) => answerDraft[question.number] !== answers[question.number])
  const dirty = actionDirty || questionDirty
  // Filter against saved results: editing a field must not hide its row mid-input.
  const rows = visibleActions(answers, all)
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', unload)
    return () => window.removeEventListener('beforeunload', unload)
  }, [dirty])

  const discardActions = (action: () => void) => {
    const proceed = () => { setEditor(null); action() }
    if (!actionDirty) { proceed(); return }
    modal.confirm({ title: '放弃未保存的行动修改？', okText: '放弃修改并继续', cancelText: '继续填写', onOk: proceed })
  }
  const reset = () => modal.confirm({ title: '重置演示？', content: '已模拟保存和未保存的演示内容都会恢复初始场景。', okText: '重置演示', cancelText: '取消', onOk: () => {
    setAnswers(initialAnswers()); setAnswerDraft(initialAnswers()); setSaved(initialActions()); setEditor(null); setAll(false)
  } })
  const saveAction = () => {
    const next = applyActionPatch(saved, patch)
    setSaved(next); setEditor(null); message.success('已模拟保存，数据仅在内存中')
  }
  const source = (row: ActionDefinition) => <div><strong>问题 {row.number}</strong><div className="preview-source"><Tag color={answers[row.number] === 'Y' ? 'green' : 'default'}>{answers[row.number] === 'Y' ? '当前触发' : answers[row.number] === 'N' ? '当前未触发' : '来源问题未回答'}</Tag></div></div>
  const shared: ColumnsType<ActionDefinition> = [
    { title: '来源问题', width: 160, render: (_, row) => source(row) },
    { title: '职能', dataIndex: 'function', width: 125 },
    { title: 'ECR 评估行动', dataIndex: 'text', width: 380, render: (text: string) => <div className="question-text">{text}</div> },
  ]
  const columns: ColumnsType<ActionDefinition> = [...shared,
    { title: '填写摘要', width: 280, render: (_, row) => {
      const value = saved[row.id] ?? EMPTY_ACTION
      return <div className="preview-summary"><div>{value.owner || '未填负责人'} · {statusLabels[value.status]} · {value.date || '未填日期'}</div><p title={value.result}>{value.result ? value.result.slice(0, 100) : '未填写评估结果'}</p></div>
    } },
    { title: '操作', width: 90, render: (_, row) => <Button type="link" onClick={() => setEditor({ action: row, values: { ...(saved[row.id] ?? EMPTY_ACTION) } })}>编辑</Button> },
  ]
  return <div className="app-shell">
    <header className="topbar"><div className="brand"><span className="brand-mark">变</span><div><strong>ECR 行动演示</strong><span>独立交互演示</span></div></div></header>
    <main className="workspace ecr-preview">
      <Alert type="info" showIcon title="布局演示，数据仅保存在内存" description="模拟保存不会写入真实申请；刷新后恢复初始场景。本页不需要登录，不调用业务接口。" className="form-alert" />
      <div className="page-heading"><div><span className="eyebrow">列表＋单条抽屉</span><h1>ECR 评估行动</h1><p className="muted">列表查看行动，打开抽屉纵向填写完整评估内容。</p></div><Button onClick={reset} disabled={!!editor}>重置演示</Button></div>
      <section className="panel list-panel preview-questions">
        <div className="section-heading"><div><h2>演示问题选择</h2><p className="muted">只保存这三个演示问题；其余问题初始未回答。选择改动后，先模拟保存，再观察行动联动。</p></div></div>
        {DEMO_QUESTIONS.map((question) => <div className="preview-question" key={question.number}><div><strong>问题 {question.number}</strong><p>{question.text}</p></div><Select aria-label={`演示问题${question.number}`} value={answerDraft[question.number]} options={answerOptions} disabled={!!editor} style={{ width: 115 }} onChange={(answer: Answer) => setAnswerDraft((current) => ({ ...current, [question.number]: answer }))} /></div>)}
        <div className="form-footer"><span className={questionDirty ? 'save-status unsaved' : 'save-status'}>{questionDirty ? '演示答案尚未保存，列表仍按原答案显示' : '演示答案已保存'}</span><Button type="primary" disabled={!!editor || !questionDirty} onClick={() => discardActions(() => { setAnswers({ ...answerDraft }); message.success('已保存演示答案并刷新联动') })}>保存演示答案</Button></div>
      </section>
      <section className="panel list-panel">
        <div className="section-heading preview-toolbar"><div><h2>ECR 评估行动</h2><p className="muted">显示 {rows.length} / 61 条 · 问题 6 关联 11 条，问题 18 关联 6 条</p></div><Select aria-label="行动筛选" disabled={!!editor} value={all ? 'all' : 'relevant'} options={[{ value: 'relevant', label: '当前触发' }, { value: 'all', label: '全部行动' }]} style={{ width: 185 }} onChange={(value) => discardActions(() => setAll(value === 'all'))} /></div>
        <Table<ActionDefinition> rowKey="id" columns={columns} dataSource={rows} pagination={false} scroll={{ x: 1035 }} locale={{ emptyText: <Empty description="尚无当前触发的行动，请保存演示答案，或切换全部行动。" /> }} />
      </section>
      <p className="muted preview-footer">未触发时隐藏，不删除已有填写；触发后重新出现。全部行动中可查看和编辑未触发内容。</p>
    </main>
    <Drawer open={!!editor} title={editor && `问题 ${editor.action.number} · 评估行动`} size={720} onClose={() => discardActions(() => {})} footer={editor && <div className="form-footer"><span className={actionDirty ? 'save-status unsaved' : 'save-status'}>{actionDirty ? '有未保存的修改' : '无未保存修改'}</span><Button type="primary" disabled={!actionDirty} onClick={saveAction}>模拟保存这条行动</Button></div>}>
      {editor && <div className="preview-drawer"><Tag>{editor.action.function}</Tag>{source(editor.action)}<p className="question-text">{editor.action.text}</p>
        <label htmlFor="preview-owner">负责人</label><Input id="preview-owner" maxLength={255} value={editor.values.owner} onChange={(event) => setEditor({ ...editor, values: { ...editor.values, owner: event.target.value } })} />
        <label htmlFor="preview-result">评估结果</label><Input.TextArea id="preview-result" value={editor.values.result} autoSize={{ minRows: 5, maxRows: 12 }} onChange={(event) => setEditor({ ...editor, values: { ...editor.values, result: event.target.value } })} />
        <div className="form-grid"><div><label htmlFor="preview-status">评估状态</label><Select id="preview-status" aria-label="评估状态" style={{ width: '100%' }} value={editor.values.status} options={statusOptions} onChange={(status: ActionValues['status']) => setEditor({ ...editor, values: { ...editor.values, status } })} /></div><div><label htmlFor="preview-date">日期</label><Input id="preview-date" type="date" value={editor.values.date} onChange={(event) => setEditor({ ...editor, values: { ...editor.values, date: event.target.value } })} /></div></div>
      </div>}
    </Drawer>
  </div>
}
