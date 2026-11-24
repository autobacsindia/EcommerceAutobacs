/**
 * Query keys for `/staff/delays/*` ("My delays"). Kept beside the feature
 * (not in hooks/queries/keys.ts) so this piece owns its own file; the shape
 * follows the same factory convention: every key starts with `delayKeys.all`,
 * so one `invalidateQueries({ queryKey: delayKeys.all })` refreshes every list
 * after an action (reason given, task done, order moved).
 */
export const delayKeys = {
  all: ['delays'] as const,
  mine: (params: Record<string, string>) => [...delayKeys.all, 'me', params] as const,
  person: (id: string, params: Record<string, string>) => [...delayKeys.all, 'person', id, params] as const,
  ranking: (params: Record<string, string>) => [...delayKeys.all, 'ranking', params] as const,
};
