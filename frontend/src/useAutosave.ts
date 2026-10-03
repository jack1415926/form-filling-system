import { useEffect, useState } from 'react'
import { Autosave, type Fields } from './autosave'

export const discardSavedWarning = '仅放弃尚未保存的修改；已自动保存的内容不会撤销。若上次保存结果未确认，服务器可能已经保存。'

type SaveControls = {
  queue: Autosave; values: Fields; dirty: boolean; pending: boolean; manual: boolean; error: Error | null; status: string
  update: (fields: Fields) => void; manualSave: () => Promise<void>; clickSave: () => void
  composition: { onCompositionStart: () => void; onCompositionEnd: () => void }
}
export default function useAutosave(options: {
  fields: Fields; send: (patch: Fields) => Promise<Fields>; enabled: boolean; auto?: boolean; force?: boolean; valid?: boolean | ((values: Fields) => boolean); paused?: boolean
  onDirty: (dirty: boolean) => void; onBusy: (busy: boolean) => void
}): SaveControls {
  const [, render] = useState(0)
  // Handlers read the current committed options; the queue itself lives for this editor's lifetime.
  const [queue] = useState(() => new Autosave(options.fields, options.send, () => render((value) => value + 1)))
  const [composing, setComposing] = useState(false)
  const valid = typeof options.valid === 'function' ? options.valid(queue.values) : options.valid !== false
  useEffect(() => { queue.setSend(options.send) }, [queue, options.send])
  useEffect(() => { queue.setOnDispose(() => { options.onBusy(false); options.onDirty(false) }) }, [queue, options])
  useEffect(() => {
    queue.activate()
    const resume = () => queue.resume()
    window.addEventListener('editor-reauthenticated', resume)
    return () => { queue.dispose(); window.removeEventListener('editor-reauthenticated', resume) }
  }, [queue])
  useEffect(() => {
    queue.configure(options.enabled && options.auto !== false, valid && !composing, !!options.paused)
  }, [queue, options.enabled, options.auto, valid, options.paused, composing])
  useEffect(() => { queue.refresh(options.fields) }, [queue, options.fields, queue.dirty, queue.pending])
  useEffect(() => { options.onDirty(queue.dirty); options.onBusy(queue.pending || queue.manual) }, [options, queue, queue.dirty, queue.pending, queue.manual])
  const manualSave = async () => {
    if (!options.enabled) throw new Error('当前不能保存')
    await queue.flush(options.force)
    if (!queue.active) throw new Error('编辑页面已关闭')
  }
  return {
    queue, values: queue.values, dirty: queue.dirty, pending: queue.pending, manual: queue.manual, error: queue.error, status: queue.status,
    update: (fields: Fields) => queue.update(fields), manualSave,
    composition: { onCompositionStart: () => setComposing(true), onCompositionEnd: () => setComposing(false) },
    clickSave: () => { void manualSave().catch(() => {}) },
  }
}
