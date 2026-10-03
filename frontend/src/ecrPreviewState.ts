import { ECR_ACTIONS } from './ecrPreviewData.ts'

export type ActionDefinition = typeof ECR_ACTIONS[number]
export type Answer = '' | 'Y' | 'N'
export type Answers = Record<number, Answer>
export type ActionValues = { owner: string; result: string; status: '' | 'completed' | 'not_applicable'; date: string }
export type ActionStore = Record<string, ActionValues>
export type ActionPatch = Record<string, Partial<ActionValues>>
export const EMPTY_ACTION: ActionValues = { owner: '', result: '', status: '', date: '' }

export function initialAnswers(): Answers {
  return Object.fromEntries(Array.from({ length: 27 }, (_, i) => [i + 1, i === 0 ? 'N' : i === 5 ? 'Y' : '']))
}

export function initialActions(): ActionStore {
  return { ecr_001: { owner: '示例负责人', result: '此前填写的演示评估内容，来源问题改为否后仍保留。', status: 'completed', date: '2026-10-02' } }
}

export function actionPatch(saved: ActionStore, draft: ActionStore): ActionPatch {
  const changes: ActionPatch = {}
  for (const [id, values] of Object.entries(draft)) {
    const previous = saved[id] ?? EMPTY_ACTION
    const fields = Object.fromEntries((Object.keys(EMPTY_ACTION) as (keyof ActionValues)[]).filter((key) => values[key] !== previous[key]).map((key) => [key, values[key]]))
    if (Object.keys(fields).length) changes[id] = fields
  }
  return changes
}

export function applyActionPatch(saved: ActionStore, patch: ActionPatch): ActionStore {
  const next = { ...saved }
  for (const [id, fields] of Object.entries(patch)) next[id] = { ...(saved[id] ?? EMPTY_ACTION), ...fields }
  return next
}

export function visibleActions(answers: Answers, all = false): ActionDefinition[] {
  return ECR_ACTIONS.filter((action) => all || answers[action.number] === 'Y')
}
