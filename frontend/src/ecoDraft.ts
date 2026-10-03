import type { EcoAction, EcoValues } from './api.ts'

export type EcoDraft = { baseline: EcoAction; values: EcoValues }

export function createEcoDraft(action: EcoAction): EcoDraft {
  return { baseline: action, values: { owner: action.owner, result: action.result, status: action.status, date: action.date } }
}

export function refreshEcoDraft(draft: EcoDraft, latest: EcoAction, dirty: boolean, saving: boolean, unconfirmed: boolean): EcoDraft {
  if (draft.baseline === latest || dirty || saving || unconfirmed) return draft
  return createEcoDraft(latest)
}
