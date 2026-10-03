import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Drawer, Dropdown, Empty, Form, Input, Select, Table, Tabs, Tag } from 'antd'
import DispositionFields from './DispositionFields'
import { api, type ChangeRequest, type Material, type MaterialCategory, type MaterialValues } from './api'

const categories: { key: MaterialCategory; label: string }[] = [
  { key: 'revision', label: '升版的物料或文件' },
  { key: 'addition', label: '新增的物料' },
  { key: 'discontinuation', label: '由于此变更而停用的物料' },
]
const commonFields: { key: keyof MaterialValues; label: string; long?: boolean }[] = [
  { key: 'material_no', label: '物料号或文件号' },
  { key: 'description', label: '物料描述／文件标题', long: true },
  { key: 'material_class', label: '物料分类' },
]
const categoryFields: Record<MaterialCategory, typeof commonFields> = {
  revision: [{ key: 'old_revision', label: '旧版本' }, { key: 'new_revision', label: '新版本' }, { key: 'change_description', label: '变更描述', long: true }],
  addition: [{ key: 'revision', label: '版本' }, { key: 'detailed_class', label: '详细分类' }],
  discontinuation: [{ key: 'revision', label: '版本' }, { key: 'discontinued_project', label: '在哪个项目停用？' }, { key: 'change_description', label: '变更描述', long: true }],
}

function MaterialForm({ material, category, path, ownerId, locked, leaving, onDirty, onBusy, onSaved }: {
  material?: Material; category: MaterialCategory; path: string; ownerId: number; locked: boolean; leaving: boolean
  onDirty: (value: boolean) => void; onBusy: (value: boolean) => void; onSaved: () => void
}) {
  const [form] = Form.useForm<MaterialValues>()
  const [requestId] = useState(() => crypto.randomUUID())
  const changedFields = useRef(new Set<keyof MaterialValues>())
  const changedDispositions = useRef<Record<string, Set<'disposition' | 'remark'>>>({})
  const fields = [...commonFields, ...categoryFields[category]]
  const save = useMutation({
    mutationFn: (values: MaterialValues) => {
      const keys = material ? [...changedFields.current] : [...fields.map((field) => field.key), 'spare_part', 'optional_part'] as (keyof MaterialValues)[]
      const payload = Object.fromEntries(keys.map((key) => [key, values[key] ?? '']))
      if (category !== 'addition') {
        if (!material) payload.dispositions = Object.fromEntries(Object.entries(values.dispositions ?? {}).map(([key, value]) => [key, { disposition: value.disposition ?? '', remark: value.remark ?? '' }]))
        else if (Object.keys(changedDispositions.current).length) payload.dispositions = Object.fromEntries(Object.entries(changedDispositions.current).map(([key, fields]) => [key, Object.fromEntries([...fields].map((field) => [field, values.dispositions?.[key]?.[field] ?? '']))]))
      }
      return api<Material>(material ? path + material.id + '/' : path, material ? 'PATCH' : 'POST', material ? payload : { ...payload, category, request_id: requestId }, ownerId)
    },
    onMutate: () => onBusy(true),
    onSettled: () => onBusy(false),
    onSuccess: () => { onDirty(false); onSaved() },
  })
  const materialFields = <>
    {fields.map((field) => <Form.Item key={field.key} name={field.key} label={field.label} rules={field.long ? [] : [{ max: 255, message: '最多 255 个字符' }]}>
      {field.long ? <Input.TextArea autoSize={{ minRows: 3, maxRows: 10 }} /> : <Input maxLength={255} />}
    </Form.Item>)}
    <div className="form-grid">{(['spare_part', 'optional_part'] as const).map((key) => <Form.Item key={key} name={key} label={key === 'spare_part' ? '维修备件' : '选配件'}>
      <Select options={[{ value: '', label: '未填写' }, { value: 'Y', label: 'Y' }, { value: 'N', label: 'N' }]} />
    </Form.Item>)}</div>
  </>
  return <Form id="material-form" form={form} layout="vertical" requiredMark={false} initialValues={material ?? { spare_part: '', optional_part: '', dispositions: {} }}
    disabled={locked || leaving || save.isPending} onFinish={(values) => save.mutate(values)}
    onValuesChange={(values: Partial<MaterialValues>) => {
      Object.keys(values).filter((key) => key !== 'dispositions').forEach((key) => changedFields.current.add(key as keyof MaterialValues))
      for (const [key, fields] of Object.entries(values.dispositions ?? {})) {
        const changed = changedDispositions.current[key] ??= new Set()
        Object.keys(fields).forEach((field) => changed.add(field as 'disposition' | 'remark'))
      }
      onDirty(true)
    }}>
    {category === 'addition' ? materialFields : <Tabs items={[
      { key: 'material', label: '物料信息', forceRender: true, children: materialFields },
      { key: 'disposition', label: '处置建议', forceRender: true, children: <DispositionFields /> },
    ]} />}
    {save.error && <Alert type="error" showIcon title="保存失败，填写内容仍保留" description={save.error.message} className="form-alert" />}
  </Form>
}

export default function MaterialEditor({ record, onDirty, onBusy, onBack, leaving, onReauthenticate, onNext, onEditorOpen }: {
  record: ChangeRequest; onDirty: (value: boolean) => void; onBusy: (value: boolean) => void; onBack: () => void; leaving: boolean; onReauthenticate: () => void
  onNext: () => void; onEditorOpen: (value: boolean) => void
}) {
  const { modal, message } = App.useApp()
  const queryClient = useQueryClient()
  const path = `/api/changes/${record.id}/materials/`
  const [editor, setEditor] = useState<{ category: MaterialCategory; material?: Material } | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState<MaterialCategory | ''>('')
  useEffect(() => { onEditorOpen(!!editor); return () => onEditorOpen(false) }, [editor, onEditorOpen])
  const locked = record.status !== 'draft'
  const materials = useQuery({ queryKey: ['materials', record.applicant, record.id], queryFn: () => api<Material[]>(path, 'GET', undefined, record.applicant), refetchOnWindowFocus: false })
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['materials', record.applicant, record.id] })
    void queryClient.invalidateQueries({ queryKey: ['change', record.applicant, record.id] })
    void queryClient.invalidateQueries({ queryKey: ['changes', record.applicant] })
  }
  const deletion = useMutation({
    mutationFn: (id: number) => api<void>(path + id + '/', 'DELETE', undefined, record.applicant),
    onMutate: () => onBusy(true), onSettled: () => onBusy(false),
    onSuccess: () => { refresh(); message.success('物料已删除') },
  })
  const busy = saving || deletion.isPending || leaving
  const close = () => {
    if (busy) return
    const discard = () => { setEditor(null); setDirty(false); onDirty(false) }
    if (!dirty) { discard(); return }
    modal.confirm({ title: '放弃未保存的物料修改？', okText: '放弃修改', cancelText: '继续填写', onOk: discard })
  }
  return <>
    <div className="page-heading"><div><span className="eyebrow">申请 #{record.id}</span><h1>物料明细</h1><p className="muted">分别记录升版、新增和停用的物料，物料信息和处置建议一起保存。</p></div><Button disabled={busy} onClick={onBack}>返回我的申请</Button></div>
    {locked && <Alert type="info" title="申请已锁定，物料仅供查看。" className="form-alert" />}
    {materials.error ? <Alert type="error" title={materials.error.message} action={<Button onClick={() => void materials.refetch()}>重试</Button>} /> : <section className="panel list-panel material-section">
      <div className="section-heading"><h2>物料明细</h2><div className="form-actions"><span className="muted">类别筛选</span><Select aria-label="类别筛选" value={filter} onChange={setFilter} disabled={busy || !!editor} options={[{ value: '', label: '不限' }, { value: 'revision', label: '升版' }, { value: 'addition', label: '新增' }, { value: 'discontinuation', label: '停用' }]} style={{ width: 110 }} />{!locked && <Dropdown trigger={['click']} disabled={busy || !!editor || materials.isPending} menu={{ items: categories.map((category) => ({ key: category.key, label: category.label })), onClick: ({ key }) => { deletion.reset(); if (filter) setFilter(key as MaterialCategory); setEditor({ category: key as MaterialCategory }) } }}><Button type="primary" disabled={busy || !!editor || materials.isPending}>新增物料</Button></Dropdown>}</div></div>
      <Table<Material> rowKey="id" loading={materials.isPending} dataSource={(materials.data ?? []).filter((item) => !filter || item.category === filter)} scroll={{ x: 950 }} pagination={{ pageSize: 10, hideOnSinglePage: true }} locale={{ emptyText: <Empty description="暂无物料" /> }} columns={[
        { title: '类别', render: (_, item) => <Tag>{({ revision: '升版', addition: '新增', discontinuation: '停用' })[item.category]}</Tag> },
        { title: '物料号／文件号', dataIndex: 'material_no', render: (value: string) => value || '—' },
        { title: '描述／标题', dataIndex: 'description', width: 230 },
        { title: '版本', render: (_, item) => item.category === 'revision' ? `${item.old_revision || '—'} → ${item.new_revision || '—'}` : item.revision || '—' },
        { title: '已填写处置', render: (_, item) => item.category === 'addition' ? '不适用' : `${Object.values(item.dispositions ?? {}).filter((value) => value.disposition || value.remark).length} / 10` },
        { title: '操作', width: 150, render: (_, item) => <div className="form-actions"><Button type="link" disabled={busy || !!editor} onClick={() => { deletion.reset(); setEditor({ category: item.category, material: item }) }}>{locked ? '查看' : '编辑'}</Button>{!locked && <Button type="link" danger disabled={busy || !!editor} onClick={() => modal.confirm({ title: '删除这条物料及其处置？', content: item.material_no || '未填写物料号', okText: '删除', cancelText: '取消', okButtonProps: { danger: true }, onOk: async () => { try { await deletion.mutateAsync(item.id) } catch { /* Render the API error below the list. */ } } })}>删除</Button>}</div> },
      ]} />
    </section>}
    {deletion.error && <Alert type="error" showIcon title="删除失败" description={deletion.error.message} className="form-alert" />}
    <div className="form-footer"><span className="muted">继续填写变更问题评估。</span><Button disabled={busy || !!editor} onClick={onNext}>下一页</Button></div>
    <Drawer open={!!editor} title={editor && `${editor.material ? locked ? '查看' : '编辑' : '新增'}：${categories.find((item) => item.key === editor.category)?.label}`} onClose={close} closable={!busy} maskClosable={!busy} keyboard={!busy} size={720} footer={editor && <div className="form-footer"><span className={dirty ? 'save-status unsaved' : 'save-status'}>{dirty ? '有未保存的修改' : editor.material ? '已保存' : '尚未保存'}</span>{!locked && <Button type="primary" htmlType="submit" form="material-form" loading={saving} disabled={busy}>{editor.category === 'addition' ? '保存物料' : '保存物料及处置'}</Button>}</div>} extra={<Button disabled={busy} onClick={onReauthenticate}>重新登录</Button>}>
      {editor && <MaterialForm key={editor.material?.id ?? editor.category} {...editor} path={path} ownerId={record.applicant} locked={locked} leaving={leaving}
        onDirty={(value) => { setDirty(value); onDirty(value) }} onBusy={(value) => { setSaving(value); onBusy(value) }}
        onSaved={() => { setEditor(null); setDirty(false); refresh(); message.success('物料已保存') }} />}
    </Drawer>
  </>
}
