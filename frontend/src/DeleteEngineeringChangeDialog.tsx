import { useState } from 'react'
import { Alert, Checkbox, Descriptions, Modal } from 'antd'
import { processStates, type EngineeringChange } from './engineeringChangeData'

export default function DeleteEngineeringChangeDialog({ row, pending, error, onCancel, onConfirm }: {
  row: EngineeringChange; pending: boolean; error: Error | null; onCancel: () => void; onConfirm: (deleteEco: boolean) => void
}) {
  const [deleteEco, setDeleteEco] = useState(false)
  const hasEco = row.eco.id !== null
  return <Modal open title="永久删除整项工程变更？" onCancel={onCancel} onOk={() => onConfirm(deleteEco)}
    okText="永久删除整项" cancelText="取消" confirmLoading={pending}
    okButtonProps={{ danger: true, disabled: hasEco && !deleteEco }} cancelButtonProps={{ disabled: pending }}
    closable={!pending} mask={{ closable: !pending }} keyboard={!pending}>
    <p>{row.title || '未命名工程变更'}</p>
    <Descriptions column={1} items={[
      { key: 'ecr', label: 'ECR', children: `${row.ecr.number || '编号未填写'} · #${row.id} · ${processStates[row.ecr.status as keyof typeof processStates]}` },
      { key: 'eco', label: '关联 ECO', children: hasEco ? `${row.eco.number || '编号未填写'} · #${row.eco.id} · ${processStates[row.eco.status as keyof typeof processStates]}` : '无' },
    ]} />
    <Alert type="warning" showIcon title="删除后无法恢复" style={{ margin: '16px 0' }}
      description="将永久删除所列流程的全部表单、行动任务、审核意见、轮次快照、批准及发布记录。" />
    {hasEco && <><Checkbox checked={deleteEco} disabled={pending} onChange={event => setDeleteEco(event.target.checked)}>同时删除关联 ECO</Checkbox><p className="muted">必须勾选才能删除；不勾选并取消，将保留 ECR 和 ECO。</p></>}
    {error && <Alert type="error" showIcon title={error.message} />}
  </Modal>
}
