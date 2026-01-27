import { useEffect, useRef, useCallback, useState } from 'react';

interface SSEMessage {
  type: string;
  timestamp: number;
  data?: any;
  message?: string;
}

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

interface UseSSEOptions {
  url: string;
  token: string | null; // Token passed from AuthContext
  enabled?: boolean; // Allow disabling the connection
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
  const abortControllerRef = useRef<AbortController | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const isConnectedRef = useRef(false);

  const connect = useCallback(async () => {
    // Don't connect if disabled or no token
    if (!enabled || !token) {
      if (!token) {
        console.log('SSE: No token available, skipping connection');
      }
      return;
    }

    // Cancel any existing connection
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Clear any pending reconnect
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    setConnectionState('connecting');
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      console.log(`SSE: Connecting to ${url}`);
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'text/event-stream'
        },
        signal: abortController.signal
      });

      if (!response.ok) {
        throw new Error(`SSE connection failed: ${response.status} ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error('Response body is null');
      }

      setConnectionState('connected');
      isConnectedRef.current = true;
      reconnectAttemptsRef.current = 0;
      onConnect?.();

      // Read the stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
          console.log('SSE stream ended');
          break;
        }

        // Decode the chunk and add to buffer
        buffer += decoder.decode(value, { stream: true });

        // Process complete messages
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || ''; // Keep incomplete message in buffer

        for (const line of lines) {
          if (line.trim().startsWith('data: ')) {
            try {
              const data = line.substring(6); // Remove 'data: ' prefix
              const message = JSON.parse(data);
              onMessage(message);
            } catch (error) {
              console.error('Error parsing SSE message:', error);
            }
          }
        }
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log('SSE connection aborted');
        return;
      }

      console.error('SSE connection error:', error);
      setConnectionState('error');
      isConnectedRef.current = false;
      onError?.(error);

      // Attempt to reconnect with exponential backoff
      if (reconnectAttemptsRef.current < maxReconnectAttempts) {
        const delay = reconnectDelay * Math.pow(2, reconnectAttemptsRef.current);
        const cappedDelay = Math.min(delay, 15000); // Cap at 15 seconds
        
        reconnectAttemptsRef.current++;
        console.log(`Reconnecting in ${cappedDelay}ms (attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts})`);
        
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, cappedDelay);
      } else {
        console.error('Max reconnection attempts reached');
        setConnectionState('error');
      }
    }
  }, [url, token, enabled, onMessage, onError, onConnect, reconnectDelay, maxReconnectAttempts]);

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
    isConnectedRef.current = false;
    reconnectAttemptsRef.current = 0;
  }, []);

  useEffect(() => {
    connect();

    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  return {
    connectionState,
    connect,
    disconnect
  };
}
