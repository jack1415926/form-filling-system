import { useEffect, useState } from 'react'
import { Alert, Button, Drawer, Table } from 'antd'
import definitions from '../../backend/changes/eco_actions.json'

export default function InactiveEcoSheet({ onEditorOpen }: { onEditorOpen: (open: boolean) => void }) {
  const [selected, setSelected] = useState<typeof definitions[number] | null>(null)
  useEffect(() => { onEditorOpen(!!selected); return () => onEditorOpen(false) }, [selected, onEditorOpen])
  return <section className="panel list-panel"><h1>ECO执行行动 · 本流程只读模板</h1><Alert type="info" className="form-alert" title="本ECR流程保留ECO Sheet供查看，不分配、填写或确认ECO行动。" description="ECR发布后显式启动独立ECO，再进入该ECO处理执行行动。" />
    <Table rowKey="id" dataSource={definitions} pagination={{ pageSize: 10 }} columns={[{ title: '来源问题', dataIndex: 'number', width: 95 }, { title: '职能', dataIndex: 'function', width: 100 }, { title: 'ECO行动模板', dataIndex: 'text', render: (text: string) => <p className="question-text">{text}</p> }, { title: '操作', render: (_, row) => <Button onClick={() => setSelected(row)}>查看模板</Button> }]} />
    <Drawer open={!!selected} title="ECO行动模板（只读）" onClose={() => setSelected(null)} size={640}>{selected && <><p>问题{selected.number} · {selected.function}</p><p className="question-text">{selected.text}</p></>}</Drawer>
  </section>
}
