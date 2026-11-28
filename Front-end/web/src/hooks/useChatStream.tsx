'use client';

/**
 * One team-chat live stream per browser tab.
 *
 * Every panel page already holds `/chat/stream` open for calls (CallProvider).
 * The Chat page used to open a SECOND copy of the same stream for messages, so a
 * tab on Chat held two long-lived connections for the same events, and the
 * server ran two heartbeat database checks every 25 s for it.
 *
 * Long-lived connections are what a browser runs out of first: over HTTP/1.1 — which
 * office antivirus and proxies that inspect HTTPS often force — Chrome allows 6
 * connections per site, and each open stream keeps one for as long as the page is
 * open. A few panel tabs with Chat open then leave no connection for ordinary
 * requests, and the page waits until something is closed (a refresh).
 *
 * `ChatStreamProvider` (in both panel layouts) owns the one stream; components
 * subscribe with `useChatStream`. Outside a provider the hook opens its own stream,
 * exactly as before, so a component that is rendered somewhere else still works.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useSSE } from '@/hooks/useSSE';
import { useCanChat } from '@/hooks/queries/useTeamChat';

export const CHAT_STREAM_URL = '/api/v1/chat/stream';

/** What the stream sends; each listener narrows it to the events it knows. */
export type ChatStreamEvent = { type: string; timestamp: number; [key: string]: unknown };

export type ChatStreamListener = {
  onMessage: (event: ChatStreamEvent) => void;
  /** The stream (re)connected: events sent meanwhile are gone, so re-sync. */
  onConnect?: () => void;
};

type Hub = {
  subscribe: (listener: { current: ChatStreamListener }) => () => void;
};

const ChatStreamContext = createContext<Hub | null>(null);

export function ChatStreamProvider({ children }: { children: ReactNode }) {
  const canChat = useCanChat();
  const listeners = useRef(new Set<{ current: ChatStreamListener }>());
  const connected = useRef(false);

  const onMessage = useCallback((event: unknown) => {
    for (const l of [...listeners.current]) {
      try { l.current.onMessage(event as ChatStreamEvent); } catch (err) { console.error('[chat stream] listener failed', err); }
    }
  }, []);
  const onConnect = useCallback(() => {
    connected.current = true;
    for (const l of [...listeners.current]) {
      try { l.current.onConnect?.(); } catch (err) { console.error('[chat stream] listener failed', err); }
    }
  }, []);
  const onError = useCallback(() => { connected.current = false; }, []);

  useSSE({ url: CHAT_STREAM_URL, token: null, enabled: canChat, onMessage, onConnect, onError });
  useEffect(() => { if (!canChat) connected.current = false; }, [canChat]);

  const hub = useMemo<Hub>(() => ({
    subscribe: (listener) => {
      listeners.current.add(listener);
      // Joining a stream that is already up is, for this listener, the same as its
      // own stream connecting: it was not listening before, so let it re-sync.
      if (connected.current) {
        try { listener.current.onConnect?.(); } catch (err) { console.error('[chat stream] listener failed', err); }
      }
      return () => { listeners.current.delete(listener); };
    },
  }), []);

  return <ChatStreamContext.Provider value={hub}>{children}</ChatStreamContext.Provider>;
}

/**
 * Listen to the team-chat live stream. Shares the panel's one stream when inside
 * a `ChatStreamProvider`; otherwise opens its own.
 */
export function useChatStream({ enabled, onMessage, onConnect }: ChatStreamListener & { enabled: boolean }) {
  const hub = useContext(ChatStreamContext);
  const latest = useRef<ChatStreamListener>({ onMessage, onConnect });
  latest.current = { onMessage, onConnect };

  useEffect(() => {
    if (!hub || !enabled) return;
    return hub.subscribe(latest);
  }, [hub, enabled]);

  // No provider above: the stream this component used to open on its own.
  useSSE({
    url: CHAT_STREAM_URL,
    token: null,
    enabled: !hub && enabled,
    onMessage: (event) => latest.current.onMessage(event as unknown as ChatStreamEvent),
    onConnect: () => latest.current.onConnect?.(),
  });
}
