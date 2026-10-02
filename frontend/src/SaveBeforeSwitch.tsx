import { useState } from 'react'
import { Button } from 'antd'

export type SaveHandle = { save: () => Promise<void> }

export default function SaveBeforeSwitch({ save, switchPage, discard, close }: {
  save: () => Promise<void>; switchPage: () => void; discard: () => void; close: () => void
}) {
  const [saving, setSaving] = useState(false)
  return <div className="form-actions" style={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
    <Button disabled={saving} onClick={close}>继续填写</Button>
    <Button disabled={saving} danger onClick={discard}>放弃修改并切换</Button>
    <Button type="primary" loading={saving} onClick={async () => {
      setSaving(true)
      try { await save(); switchPage(); close() }
      catch { setSaving(false) /* The current editor displays the validation/API error. */ }
    }}>保存并切换</Button>
  </div>
}
