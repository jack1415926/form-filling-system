import { Form, Input, Select, Table } from 'antd'

const locations = [
  { group: '诺令库存', items: [['company_finished', '成品'], ['company_wip', '在制品'], ['company_raw', '原料']] },
  { group: '供应商库存', items: [['supplier_finished', '成品'], ['supplier_wip', '在制品'], ['supplier_raw', '原材料'], ['supplier_rma', 'RMA']] },
  { group: '客户现场', items: [['customer_return', '现场退货'], ['customer_site', '在客户处'], ['customer_spares', '维修备件仓库']] },
]
const choices = ['', 'Use-up', 'Scrap', 'Rework', 'No Change', 'Balance', 'NA'].map((value) => ({ value, label: value || '未填写' }))
export default function DispositionFields() {
  return <>{locations.map((group) => <section key={group.group} className="material-section">
    <h3>{group.group}</h3>
    <Table rowKey="key" pagination={false} size="small" dataSource={group.items.map(([key, label]) => ({ key, label }))} columns={[
      { title: '位置', dataIndex: 'label', width: 130 },
      { title: '处置方式', width: 175, render: (_, item) => <Form.Item name={['dispositions', item.key, 'disposition']} style={{ margin: 0 }}><Select aria-label={`${group.group} ${item.label} 处置方式`} options={choices} placeholder="未填写" /></Form.Item> },
      { title: '备注', render: (_, item) => <Form.Item name={['dispositions', item.key, 'remark']} style={{ margin: 0 }}><Input aria-label={`${group.group} ${item.label} 备注`} /></Form.Item> },
    ]} />
  </section>)}</>
}
