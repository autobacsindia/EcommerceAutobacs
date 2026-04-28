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
  maxReconnectAttempts?: number;
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
      // Clear any pending reconnect timer
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }

      setConnectionState('connecting');
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      try {
        console.log(`SSE: Connecting to ${currentUrl}`);
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
          // With httpOnly cookies, 401 means session expired
          // Don't try to refresh - just report error and let user re-login
          if (response.status === 401) {
            console.warn('SSE: 401 Unauthorized - session expired');
            throw new Error('SSE connection failed: 401 Unauthorized');
          }
          throw new Error(`SSE connection failed: ${response.status} ${response.statusText}`);
        }

        if (!response.body) throw new Error('Response body is null');

        if (!isMountedRef.current) return;
        setConnectionState('connected');
        reconnectAttemptsRef.current = 0;
        console.log('SSE: Connected successfully');
        onConnectRef.current?.();

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (!isMountedRef.current) break;
          if (done) { console.log('SSE stream ended'); break; }

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
      } catch (error: any) {
        if (error.name === 'AbortError') {
          console.log('SSE connection aborted');
          return;
        }

        const isNetworkError = error instanceof TypeError && error.message === 'Failed to fetch';
        if (isNetworkError) {
          console.log('SSE: Backend unreachable, will retry...');
        } else {
          console.error('SSE connection error:', error);
        }

        if (!isMountedRef.current) return;
        setConnectionState('error');
        // Don't surface network errors to onError — backend being down is expected/retriable
        if (!isNetworkError) {
          onErrorRef.current?.(error);
        }

        const maxAttempts = maxReconnectAttemptsRef.current;
        if (reconnectAttemptsRef.current < maxAttempts) {
          const delay = Math.min(
            reconnectDelayRef.current * Math.pow(2, reconnectAttemptsRef.current),
            15000
          );
          reconnectAttemptsRef.current++;
          console.log(`Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current}/${maxAttempts})`);
          reconnectTimeoutRef.current = setTimeout(() => {
            connectFnRef.current().catch(() => {});
          }, delay);
        } else {
          console.error('Max reconnection attempts reached');
        }
      }
    };

    connectFnRef.current = connectInternal;
  });

  const disconnect = useCallback(() => {
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
