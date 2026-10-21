import type { QueryClient } from '@tanstack/react-query'

export async function refreshQuestionDependents(client: QueryClient, actorId: number, changeId: number): Promise<void> {
  // 问题回答决定行动和提交准入，不能只更新问题页而让其他页面继续使用旧缓存。
  await Promise.all([
    ...['ecr-actions', 'eco-actions', 'stage-workflow', 'change'].map(resource =>
      client.invalidateQueries({ queryKey: [resource, actorId, changeId] })),
    client.invalidateQueries({ queryKey: ['changes', actorId] }),
  ])
}
