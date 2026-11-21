import { useEffect, useRef, useCallback, useState } from 'react';
import apiClient from '@/lib/api';

interface SSEMessage {
  type: string;
  timestamp: number;
  data?: any;
  message?: string;
}

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

interface UseSSEOptions {
  url: string;
  token: string | null;
  enabled?: boolean;
  onMessage: (message: SSEMessage) => void;
  onError?: (error: Error) => void;
  onConnect?: () => void;
  reconnectDelay?: number;
  /** Fast retries before slowing to one try every SLOW_RETRY_MS. It never gives up for good. */
  maxReconnectAttempts?: number;
}

/*
 * Reconnect policy.
 *
 * A live stream can end three ways, and every one must lead back to a connected
 * stream while the page is open — a page that silently stops listening is the
 * "live notifications / calls work in one browser but not the other" bug:
 *   1. the server or a proxy closes it cleanly (deploy, restart, proxy limit):
 *      the reader reports `done` — this used to end the loop for good;
 *   2. the network drops it (Wi-Fi change, laptop sleep): fetch/read throws;
 *   3. it goes half-open (sleep, NAT timeout): no error, no data, for ever.
 *      The server beats every ~25 s, so silence past STALE_AFTER_MS means dead.
 * After `maxReconnectAttempts` fast tries it keeps trying every SLOW_RETRY_MS
 * (it used to stop at 10), and coming back online or to the tab retries at once.
 */
export const STALE_AFTER_MS = 70_000;
export const SLOW_RETRY_MS = 60_000;
export const MAX_FAST_DELAY_MS = 15_000;

/** Wait before reconnect attempt `attempt` (0-based). */
export function backoffDelay(attempt: number, baseMs: number, maxFastAttempts: number): number {
  if (attempt >= maxFastAttempts) return SLOW_RETRY_MS;
  return Math.min(baseMs * Math.pow(2, attempt), MAX_FAST_DELAY_MS);
}

export function useSSE({
  url,
  token,
  enabled = true,
  onMessage,
  onError,
  onConnect,
  reconnectDelay = 1000,
  maxReconnectAttempts = 10
}: UseSSEOptions) {
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');

  // Store all mutable state and callbacks in refs to avoid stale closures
  const abortControllerRef = useRef<AbortController | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const isRefreshingRef = useRef(false);
  // True once we've already attempted a token refresh for the current connection
  // cycle. A 401 that persists *after* a successful refresh is a genuine
  // authorization failure, not an expired access token — retrying would just
  // hammer /auth/refresh. Reset on a successful connect or a fresh trigger.
  const hasRefreshedRef = useRef(false);
  const isMountedRef = useRef(false);

  // Keep latest prop values in refs so the connect loop never goes stale
  const urlRef = useRef(url);
  const tokenRef = useRef(token);
  const enabledRef = useRef(enabled);
  const onMessageRef = useRef(onMessage);
  const onErrorRef = useRef<((error: Error) => void) | undefined>(onError);
  const onConnectRef = useRef<(() => void) | undefined>(onConnect);
  const reconnectDelayRef = useRef(reconnectDelay);
  const maxReconnectAttemptsRef = useRef(maxReconnectAttempts);

  // Sync all refs on every render — zero dependency arrays needed
  urlRef.current = url;
  tokenRef.current = token;
  enabledRef.current = enabled;
  onMessageRef.current = onMessage;
  onErrorRef.current = onError;
  onConnectRef.current = onConnect;
  reconnectDelayRef.current = reconnectDelay;
  maxReconnectAttemptsRef.current = maxReconnectAttempts;

  // connectFnRef holds the stable connect function so setTimeout can always
  // call the latest version without capturing stale variables.
  const connectFnRef = useRef<() => Promise<void>>(() => Promise.resolve());
  // Silence watchdog: re-armed on every chunk from the server (see STALE_AFTER_MS).
  const staleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearStaleTimer = () => {
    if (staleTimerRef.current) clearTimeout(staleTimerRef.current);
    staleTimerRef.current = null;
  };

  /** Try again after the policy's delay. One pending retry at a time. */
  const scheduleReconnect = () => {
    if (!isMountedRef.current || !enabledRef.current || reconnectTimeoutRef.current) return;
    const attempt = reconnectAttemptsRef.current;
    const delay = backoffDelay(attempt, reconnectDelayRef.current, maxReconnectAttemptsRef.current);
    reconnectAttemptsRef.current = attempt + 1;
    reconnectTimeoutRef.current = setTimeout(() => {
      reconnectTimeoutRef.current = null;
      connectFnRef.current().catch(() => {});
    }, delay);
  };

  // Build the connect logic once (stable ref, never recreated)
  useEffect(() => {
    const connectInternal = async () => {
      if (!isMountedRef.current) return;

      const currentEnabled = enabledRef.current;
      const currentUrl = urlRef.current;

      // With httpOnly cookies, we don't have token in JS state
      // Backend will authenticate via cookies automatically
      if (!currentEnabled) {
        return;
      }

      // Cancel any existing connection
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      clearStaleTimer();
      // Clear any pending reconnect timer
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }

      setConnectionState('connecting');
      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      // Aborted by the watchdog (not by us tearing down): that is a lost stream.
      let stale = false;
      const armStaleTimer = () => {
        clearStaleTimer();
        staleTimerRef.current = setTimeout(() => {
          stale = true;
          abortController.abort();
        }, STALE_AFTER_MS);
      };

      try {
        const response = await fetch(currentUrl, {
          method: 'GET',
          headers: {
            'Accept': 'text/event-stream'
          },
          // Browser sends httpOnly cookies automatically
          credentials: 'include',
          signal: abortController.signal
        });

        if (!response.ok) {
          if (response.status === 401) {
            // Attempt a silent token refresh ONCE per connection cycle. If the
            // stream still 401s after a successful refresh, the session is
            // genuinely unauthorized (not a stale access token) — re-refreshing
            // would loop, hammering /auth/refresh and flooding logs/Sentry.
            if (!hasRefreshedRef.current && !isRefreshingRef.current) {
              isRefreshingRef.current = true;
              try {
                const refreshRes = await fetch('/api/v1/auth/refresh', {
                  method: 'POST',
                  credentials: 'include',
                });
                hasRefreshedRef.current = true;
                isRefreshingRef.current = false;
                if (refreshRes.ok) {
                  // Refresh succeeded — retry SSE connection immediately
                  if (abortController.signal.aborted) return;
                  reconnectAttemptsRef.current = 0;
                  connectFnRef.current().catch(() => {});
                  return;
                }
              } catch {
                isRefreshingRef.current = false;
                hasRefreshedRef.current = true;
              }
            }
            // Refresh already attempted (or in progress) and still unauthorized —
            // session is truly expired. Stop retrying until the user logs in.
            console.warn('SSE: unauthorized, stopping reconnect');
            setConnectionState('error');
            onErrorRef.current?.(new Error('Session expired'));
            return;
          }
          throw new Error(`SSE connection failed: ${response.status} ${response.statusText}`);
        }

        if (!response.body) throw new Error('Response body is null');

        if (!isMountedRef.current) return;
        setConnectionState('connected');
        reconnectAttemptsRef.current = 0;
        hasRefreshedRef.current = false; // Fresh healthy connection — allow one refresh again later
        armStaleTimer();
        onConnectRef.current?.();

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (!isMountedRef.current) break;
          if (done) break;
          armStaleTimer();

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.trim().startsWith('data: ')) {
              try {
                const message = JSON.parse(line.substring(6));
                onMessageRef.current(message);
              } catch (e) {
                console.error('Error parsing SSE message:', e);
              }
            }
          }
        }
        clearStaleTimer();
        // The server or a proxy closed the stream cleanly (deploy, restart, a
        // proxy's time limit). The page is still open, so listen again.
        if (!isMountedRef.current || abortControllerRef.current !== abortController) return;
        setConnectionState('disconnected');
        scheduleReconnect();
      } catch (error: any) {
        clearStaleTimer();
        if (error?.name === 'AbortError' && !stale) return; // torn down or replaced on purpose
        if (!isMountedRef.current || abortControllerRef.current !== abortController) return;

        const isNetworkError = stale || (error instanceof TypeError && /fetch|network|load failed/i.test(error.message));
        if (!isNetworkError) console.error('SSE connection error:', error);

        setConnectionState('error');
        // A network-level failure (not a 401) is unrelated to auth, so allow a fresh
        // token refresh on the next 401. Without this, a refresh consumed earlier in
        // this connection's lifetime would suppress the refresh a later 401 needs.
        hasRefreshedRef.current = false;
        // Don't surface network errors to onError — backend being down is expected/retriable
        if (!isNetworkError) {
          onErrorRef.current?.(error);
        }
        scheduleReconnect();
      }
    };

    connectFnRef.current = connectInternal;
  });

  // Back online, or back to this tab after the computer slept: if the stream is
  // not up, try now rather than waiting out a (possibly one-minute) back-off.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const retryNow = () => {
      if (!isMountedRef.current || !enabledRef.current) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      // Only when waiting out a back-off: otherwise it is live, connecting now,
      // or stopped on purpose (signed out).
      if (!reconnectTimeoutRef.current) return;
      reconnectAttemptsRef.current = 0;
      connectFnRef.current().catch(() => {});
    };
    window.addEventListener('online', retryNow);
    document.addEventListener('visibilitychange', retryNow);
    return () => {
      window.removeEventListener('online', retryNow);
      document.removeEventListener('visibilitychange', retryNow);
    };
  }, []);

  const disconnect = useCallback(() => {
    if (staleTimerRef.current) clearTimeout(staleTimerRef.current);
    staleTimerRef.current = null;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    setConnectionState('disconnected');
    reconnectAttemptsRef.current = 0;
  }, []);

  // Re-run whenever url, enabled, or token changes (token arriving late must trigger connection)
  // Reset attempt counter on each fresh trigger so retries start from 0.
  useEffect(() => {
    isMountedRef.current = true;
    reconnectAttemptsRef.current = 0; // Fresh trigger = fresh retry budget
    hasRefreshedRef.current = false;  // Fresh trigger = allow one refresh attempt

    // Abort any in-flight connection / pending retry from previous run
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // Explicitly catch here so Next.js dev overlay never sees an unhandled rejection
    connectFnRef.current().catch(() => {});

    return () => {
      isMountedRef.current = false;
      disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, enabled, token]);

  const connect = useCallback(() => connectFnRef.current(), []);

  return { connectionState, connect, disconnect };
}
