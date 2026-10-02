import type { EcrAction, EcrValues } from './api.ts'

export type EcrDraft = { baseline: EcrAction; values: EcrValues }

export function createEcrDraft(action: EcrAction): EcrDraft {
  return { baseline: action, values: { owner: action.owner, result: action.result, status: action.status, date: action.date } }
}

export function refreshEcrDraft(draft: EcrDraft, latest: EcrAction, dirty: boolean, saving: boolean, unconfirmed: boolean): EcrDraft {
  if (draft.baseline === latest || dirty || saving || unconfirmed) return draft
  return createEcrDraft(latest)
}
