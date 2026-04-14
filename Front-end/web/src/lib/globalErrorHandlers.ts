/**
 * Global Error Handlers
 * 
 * Catches errors that ErrorBoundary CANNOT catch:
 * - Event handler errors
 * - Async errors (setTimeout, fetch, promises)
 * - Unhandled rejections
 * 
 * Usage: Import once in app entry point
 *   import '@/lib/globalErrorHandlers';
 */

// ── Unhandled Promise Rejections ─────────────────────────────────────────────

if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const error = event.reason;
    
    console.error('[Global] Unhandled Promise Rejection:', error);
    
    // Send to Sentry
    if ((window as any).Sentry) {
      (window as any).Sentry.captureException(error, {
        tags: { type: 'unhandledrejection' },
        extra: {
          timestamp: new Date().toISOString(),
          url: window.location.href
        }
      });
    }
    
    // Prevent default browser behavior
    event.preventDefault();
  });

  // ── Global JavaScript Errors ─────────────────────────────────────────────

  window.onerror = function (message, source, lineno, colno, error) {
    console.error('[Global] JavaScript Error:', {
      message,
      source,
      line: lineno,
      column: colno,
      error
    });
    
    // Send to Sentry
    if ((window as any).Sentry) {
      (window as any).Sentry.captureException(error || new Error(String(message)), {
        tags: { type: 'window.onerror' },
        extra: {
          source,
          line: lineno,
          column: colno,
          timestamp: new Date().toISOString(),
          url: window.location.href
        }
      });
    }
    
    // Return false to allow default browser behavior
    return false;
  };

  // ── React-Specific Error Handler ─────────────────────────────────────────

  // Catch errors in React event handlers
  const originalAddEventListener = EventTarget.prototype.addEventListener;
  
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    const wrappedListener = typeof listener === 'function' 
      ? function (this: any, ...args: any[]) {
          try {
            return (listener as Function).apply(this, args);
          } catch (error) {
            console.error(`[Global] Event handler error (${type}):`, error);
            
            // Send to Sentry
            if ((window as any).Sentry) {
              (window as any).Sentry.captureException(error, {
                tags: { 
                  type: 'event-handler',
                  eventType: type 
                },
                extra: {
                  timestamp: new Date().toISOString(),
                  url: window.location.href
                }
              });
            }
            
            throw error; // Re-throw to maintain normal behavior
          }
        }
      : listener;
    
    return originalAddEventListener.call(this, type, wrappedListener, options);
  };

  console.log('[Global] Error handlers initialized');
}

export {};
