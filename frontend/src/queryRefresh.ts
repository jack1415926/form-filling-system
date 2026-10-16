import type { QueryClient } from '@tanstack/react-query'

export async function refreshQuestionDependents(client: QueryClient, actorId: number, changeId: number): Promise<void> {
  await Promise.all([
    ...['ecr-actions', 'eco-actions', 'stage-workflow', 'change'].map(resource =>
      client.invalidateQueries({ queryKey: [resource, actorId, changeId] })),
    client.invalidateQueries({ queryKey: ['changes', actorId] }),
  ])
}
