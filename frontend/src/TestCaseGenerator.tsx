import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Descriptions, Form, Modal, Radio, Select, Space, Tag } from 'antd'
import { api, type User } from './api'

const states = [
  { value: 'draft', label: '草稿', description: '正文和人员已填好，尚未提交。' },
  { value: 'reviewing', label: '审核中', description: '已提交，行动结果已填好，等待负责人确认。' },
  { value: 'pending_approval', label: '待批准', description: '行动全部确认，等待指定批准人批准。' },
  { value: 'approved', label: '已批准', description: '批准完成，等待指定发布人发布。' },
  { value: 'published', label: '已发布', description: '发布完成，表单只读。' },
]
type Values = { stage: 'ecr' | 'eco'; state: string; people: 'self' | 'separate'; reviewer_ids: number[]; approver_ids: number[]; publisher_id: number }
type Result = { actor_id: number; id: number; stage: 'ecr' | 'eco'; state: string; number: string; source_ecr_id: number | null }

export default function TestCaseGenerator({ user, disabled, onOpen }: { user: User; disabled: boolean; onOpen: (id: number) => void }) {
  const [open, setOpen] = useState(false)
  const [form] = Form.useForm<Values>()
  const client = useQueryClient()
  const request = useRef<{ key: string; id: string } | null>(null)
  const stage = Form.useWatch('stage', form) ?? 'ecr'
  const state = Form.useWatch('state', form) ?? 'pending_approval'
  const people = Form.useWatch('people', form) ?? 'self'
  const users = useQuery({ queryKey: ['test-case-users', user.id], enabled: open,
    queryFn: () => api<User[]>('/api/action-owners/', 'GET', undefined, user.id) })
  const mutation = useMutation({
    retry: false,
    mutationFn: async (values: Values) => {
      const payload = { stage: values.stage, state: values.state,
        reviewer_ids: values.people === 'self' ? [user.id] : [...values.reviewer_ids].sort((a, b) => a - b),
        approver_ids: values.people === 'self' ? [user.id] : [...values.approver_ids].sort((a, b) => a - b),
        publisher_id: values.people === 'self' ? user.id : values.publisher_id }
      const key = JSON.stringify(payload)
      if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() }
      const result = await api<Result>('/api/test-cases/', 'POST', { ...payload, request_id: request.current.id }, user.id)
      if (result.actor_id !== user.id || !Number.isSafeInteger(result.id) || result.id <= 0 || result.stage !== payload.stage || result.state !== payload.state) {
        throw new Error('未能确认生成结果，请先刷新列表核对测试申请。')
      }
      return result
    },
    onSuccess: () => { void client.invalidateQueries({ queryKey: ['changes', user.id] }) },
  })
  const options = (users.data ?? [user]).map(person => ({ value: person.id, label: `${person.display_name}（${person.username}）` }))
  const close = () => { if (!mutation.isPending) setOpen(false) }
  const result = mutation.data
  return <>
    <Button size="large" disabled={disabled} onClick={() => setOpen(true)}>生成测试用例</Button>
    <Modal title={<Space>生成测试用例<Tag color="gold">开发测试</Tag></Space>} open={open} onCancel={close}
      closable={!mutation.isPending} mask={{ closable: !mutation.isPending }} keyboard={!mutation.isPending} width={600}
      footer={result ? <Space><Button onClick={() => { mutation.reset(); request.current = null }}>再生成一个</Button><Button type="primary" onClick={() => { close(); onOpen(result.id) }}>打开{result.stage.toUpperCase()}测试用例</Button></Space>
        : <Space><Button disabled={mutation.isPending} onClick={close}>取消</Button><Button type="primary" loading={mutation.isPending} disabled={people === 'separate' && (users.isPending || !!users.error)} onClick={() => form.submit()}>生成测试用例</Button></Space>}>
      {result ? <>
        <Alert type="success" showIcon title="测试用例已生成" description="可以直接打开申请，继续测试后续操作。" style={{ marginBottom: 24 }} />
        <Descriptions column={1} items={[
          { key: 'id', label: '申请', children: `${result.stage.toUpperCase()} #${result.id}` },
          { key: 'state', label: '目标状态', children: states.find(item => item.value === result.state)?.label },
          { key: 'number', label: '编号', children: result.number },
          ...(result.source_ecr_id ? [{ key: 'source', label: '已发布来源 ECR', children: `#${result.source_ecr_id}` }] : []),
        ]} />
      </> : <>
        <p className="muted">选择流程和状态，自动填好表单并生成一条新的测试申请。</p>
        <Form form={form} layout="vertical" requiredMark={false} disabled={mutation.isPending}
          initialValues={{ stage: 'ecr', state: 'pending_approval', people: 'self', reviewer_ids: [user.id], approver_ids: [user.id], publisher_id: user.id }}
          onFinish={values => mutation.mutate(values)} onValuesChange={() => mutation.reset()}>
          <Form.Item name="stage" label="流程"><Radio.Group options={[{ value: 'ecr', label: 'ECR' }, { value: 'eco', label: 'ECO' }]} optionType="button" buttonStyle="solid" /></Form.Item>
          <Form.Item name="state" label="目标状态" extra={states.find(item => item.value === state)?.description}><Select options={states} aria-label="目标状态" /></Form.Item>
          <Form.Item name="people" label="测试人员"><Radio.Group options={[{ value: 'self', label: '全部由我测试' }, { value: 'separate', label: '分别指定人员' }]} /></Form.Item>
          <p className="muted">申请人：{user.display_name}（{user.username}）{people === 'self' ? '；审核、批准和发布也使用此账号。' : '；其余人员可选择有效账号。'}</p>
          {people === 'separate' && <>
            {users.error && <Alert type="error" title={users.error.message} action={<Button onClick={() => void users.refetch()}>重新加载</Button>} />}
            {(['reviewer_ids', 'approver_ids'] as const).map((key, index) => <Form.Item key={key} name={key} label={['行动负责人（可多选）', '批准人（可多选）'][index]} rules={[{ required: true, type: 'array', min: 1, message: '请至少选择一位有效账号' }]}><Select mode="multiple" aria-label={['行动负责人', '批准人'][index]} showSearch={{ optionFilterProp: 'label' }} loading={users.isPending} options={options} /></Form.Item>)}
            <Form.Item name="publisher_id" label="发布人" rules={[{ required: true, message: '请选择账号' }]}><Select aria-label="发布人" showSearch={{ optionFilterProp: 'label' }} loading={users.isPending} options={options} /></Form.Item>
          </>}
        </Form>
        <Alert type="info" showIcon title={stage === 'eco' ? '将新建 2 条申请：已发布来源 ECR ＋ 目标 ECO。' : '将新建 1 条 ECR 测试申请。'}
          description="样例为自制连接件物料升版：问题6选“是”，生成对应的11项行动。已有申请保持原样，新申请以“[测试]”标识。" />
        {mutation.error && <Alert type="error" showIcon title={mutation.error.message} description="网络中断时可使用相同选择重试，原请求不会重复生成。" style={{ marginTop: 16 }} />}
      </>}
    </Modal>
  </>
}
