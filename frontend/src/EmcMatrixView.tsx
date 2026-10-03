import { Button, Collapse, Table, Tag } from 'antd'
import { cellKey, matrixHeaderGroups, testName, type Matrix } from './emcMatrix'

export function ReferenceTable({ matrix, edit, editLabel = '填写' }: { matrix: Matrix; edit?: (id: string) => void; editLabel?: string }) {
  return <Table rowKey="id" pagination={false} dataSource={matrix.rows} scroll={{ x: 1500 }} locale={{ emptyText: '暂无典型变更。' }} columns={[
    { title: '典型变更', dataIndex: 'label', width: 300, fixed: 'left' as const, render: (label: string) => <div className="question-text">{label}</div> },
    ...matrixHeaderGroups(matrix.tests).map((group, groupIndex) => ({ title: <div className="question-text emc-group-title">{group.label}</div>, key: `group-${groupIndex}`, align: 'center' as const, children: group.bands.map((band, bandIndex) => ({ title: band.label, key: `band-${groupIndex}-${bandIndex}`, align: 'center' as const, children: band.tests.map((test) => ({ title: <span title={`${test.label}\n${test.group}\n${test.standard}`}>{testName(test.label)}</span>, key: test.id, width: 100, align: 'center' as const, render: (_: unknown, row: Matrix['rows'][number]) => {
      const value = matrix.cells[cellKey(row.id, test.id)]
      return <span title={value?.remark || '空白未指定，不代表无需测试'}>{value?.mark ? <Tag color={value.mark === 'X' ? 'red' : 'orange'}>{value.mark}</Tag> : '—'}{value?.remark && <span aria-label="有备注"> * </span>}</span>
    } })), })), })),
    ...(edit ? [{ title: '操作', width: 90, fixed: 'right' as const, render: (_: unknown, row: Matrix['rows'][number]) => <Button type="link" onClick={() => edit(row.id)}>{editLabel}</Button> }] : []),
  ]} />
}
export function ReferenceNotes({ matrix }: { matrix: Matrix }) {
  return <Collapse items={[
    { key: 'intro', label: '介绍与定义', children: <><p className="question-text">{matrix.introduction}</p><p className="question-text">{matrix.definitions}</p></> },
    { key: 'legend', label: '标记说明：X / (X) / 空白', children: <><p className="question-text">{matrix.legend}</p><p className="muted">空白只表示未指定，不自动判定无需测试。这里保留源表标准文字，未作标准版本更新。</p></> },
  ]} />
}
