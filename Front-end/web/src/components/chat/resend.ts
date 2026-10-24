import { useRef } from 'react';
import type { ChatMessage, SendVars } from '@/hooks/queries/useTeamChat';

/**
 * What each message was sent with — files included — so Retry resends exactly
 * that. Rebuilding it from the failed message lost the photos: a photo-only
 * retry then arrived empty ("Message cannot be empty") and a photo + text one
 * silently dropped the photo.
 */
export function createResendStore() {
  const sent = new Map<string, SendVars>();
  return {
    remember: (vars: SendVars) => { if (vars.clientId) sent.set(vars.clientId, vars); },
    forget: (clientId: string) => { sent.delete(clientId); },
    varsFor: (msg: ChatMessage): SendVars => sent.get(msg.clientId ?? '')
      ?? { text: msg.text, clientId: msg.clientId ?? '', mentions: msg.mentions, quoteId: msg.quote?.id },
  };
}

export function useResendStore() {
  const store = useRef<ReturnType<typeof createResendStore> | null>(null);
  if (!store.current) store.current = createResendStore();
  return store.current;
}
