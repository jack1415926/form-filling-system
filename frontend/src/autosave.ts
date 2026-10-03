import { ApiError } from './api.ts'
import { saveResultUnconfirmed } from './questionDraft.ts'

export type Fields = Record<string, string | null>
type Clock = { now: () => number; set: (fn: () => void, ms: number) => unknown; clear: (id: unknown) => void }
const clock: Clock = { now: Date.now, set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>) }

// One mounted editor owns one queue. Fields use stable business keys, not row positions.
export class Autosave {
  baseline: Fields
  values: Fields
  unconfirmed = new Set<string>()
  error: Error | null = null
  pending = false
  manual = false
  enabled = true
  valid = true
  paused = false
  active = true
  private versions: Record<string, number> = {}
  private revision = 0
  private changedAt = 0
  private retries = 0
  private retryAt: number | null = null
  private blocked: 'edit' | 'manual' | null = null
  private timer: unknown
  private flight: Promise<void> | null = null
  private send: (patch: Fields) => Promise<Fields>
  private notify: () => void
  private time: Clock
  private onDispose = () => {}
  constructor(values: Fields, send: (patch: Fields) => Promise<Fields>, notify: () => void, time: Clock = clock) {
    this.send = send; this.notify = notify; this.time = time
    this.baseline = { ...values }; this.values = { ...values }
  }
  get patch(): Fields {
    return Object.fromEntries([...new Set([...Object.keys(this.baseline), ...Object.keys(this.values), ...this.unconfirmed])]
      .filter((key) => (key in this.values ? this.values[key] : '') !== (key in this.baseline ? this.baseline[key] : '') || this.unconfirmed.has(key))
      .map((key) => [key, key in this.values ? this.values[key] : '']))
  }
  get dirty() { return Object.keys(this.patch).length > 0 || !this.valid }
  get status() {
    return this.pending || this.manual ? '正在保存…' : this.error ? (this.unconfirmed.size ? '保存失败，结果未确认' : '保存失败')
      : !this.valid ? '请补全或修正输入' : this.dirty ? '等待保存…' : '已保存'
  }
  private cancel() { if (this.timer !== undefined) this.time.clear(this.timer); this.timer = undefined }
  private publish() { if (this.active) this.notify() }
  update(fields: Fields) {
    let changed = false
    for (const [key, value] of Object.entries(fields)) {
      if (this.values[key] === value) continue
      this.values[key] = value; this.versions[key] = ++this.revision; changed = true
    }
    if (changed) {
      this.changedAt = this.time.now()
      if (this.blocked === 'edit') { this.blocked = null; this.error = null }
      this.publish(); this.schedule()
    }
  }
  configure(enabled: boolean, valid: boolean, paused: boolean) {
    const resumed = this.paused && !paused || !this.valid && valid || !this.enabled && enabled
    this.enabled = enabled; this.valid = valid; this.paused = paused
    if (resumed) this.changedAt = this.time.now()
    this.schedule(); this.publish()
  }
  refresh(fields: Fields) {
    if (this.dirty || this.pending || this.manual) return
    if (JSON.stringify(fields) === JSON.stringify(this.baseline)) return
    this.baseline = { ...fields }; this.values = { ...fields }; this.publish()
  }
  resume() {
    // A successful same-account login may resume auth/CSRF failures, not exhausted network retries.
    if (this.blocked === 'manual' && this.error instanceof ApiError && [401, 403].includes(this.error.status)) {
      this.blocked = null; this.error = null; this.changedAt = this.time.now(); this.schedule(); this.publish()
    }
  }
  private schedule() {
    this.cancel()
    if (!this.active || !this.enabled || !this.valid || this.paused || this.pending || this.manual || this.blocked || !this.dirty) return
    const due = this.retryAt ?? this.changedAt + 2000
    this.timer = this.time.set(() => { this.timer = undefined; void this.run().catch(() => {}) }, Math.max(0, due - this.time.now()))
  }
  private async run(force = false) {
    if (this.flight) return this.flight
    if (!this.active || !this.valid || this.paused && !this.manual) throw new Error('请补全输入或继续填写后再保存')
    const patch = force ? { ...this.values } : this.patch
    if (!Object.keys(patch).length) return
    this.cancel()
    const submittedVersions = { ...this.versions }
    this.pending = true; this.publish()
    this.flight = (async () => {
      try {
        const saved = await this.send(patch)
        if (!this.active) return
        for (const key of new Set([...Object.keys(this.values), ...Object.keys(saved)])) {
          if (this.versions[key] === submittedVersions[key]) this.values[key] = key in saved ? saved[key] : ''
        }
        this.baseline = { ...saved }; this.unconfirmed.clear(); this.error = null
        this.retries = 0; this.retryAt = null; this.blocked = null
      } catch (error) {
        if (!this.active) return
        this.error = error instanceof Error ? error : new Error(String(error))
        if (saveResultUnconfirmed(error)) {
          Object.keys(patch).forEach((key) => this.unconfirmed.add(key))
          const delay = [5000, 15000][this.retries++]
          this.retryAt = delay === undefined ? null : this.time.now() + delay
          this.blocked = delay === undefined ? 'manual' : null
        } else {
          this.retryAt = null
          this.blocked = error instanceof ApiError && error.status === 400 ? 'edit' : 'manual'
          // A user edit made while the rejected request was in flight counts as correction.
          if (this.blocked === 'edit' && this.revision > Math.max(0, ...Object.values(submittedVersions))) this.blocked = null
        }
        throw error
      } finally {
        this.pending = false; this.flight = null; this.publish(); this.schedule()
      }
    })()
    return this.flight
  }
  async flush(force = false) {
    if (this.manual) throw new Error('正在保存，请稍候')
    this.manual = true; this.cancel(); this.publish()
    try {
      if (this.flight) await this.flight.catch(() => {})
      this.error = null; this.blocked = null; this.retries = 0; this.retryAt = null
      if (!this.valid || !this.active) throw new Error('请补全输入或继续填写后再保存')
      if (this.dirty || force) await this.run(force)
    } finally { this.manual = false; this.publish(); this.schedule() }
  }
  dispose() { this.active = false; this.cancel(); this.onDispose() }
  activate() { this.active = true }
  setSend(send: (patch: Fields) => Promise<Fields>) { this.send = send }
  setOnDispose(dispose: () => void) { this.onDispose = dispose }
}
