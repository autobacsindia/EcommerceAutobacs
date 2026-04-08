'use client';

import { useEffect } from 'react';
import LogRocket from 'logrocket';

/**
 * LogRocket Provider - Frontend Session Replay & Error Tracking
 * 
 * Complements Sentry by providing:
 * - Full session replay (video-like)
 * - User interaction tracking
 * - Network request logging
 * - Console log capture
 * 
 * Setup:
 * 1. Create account: https://app.logrocket.com/
 * 2. Get App ID from settings
 * 3. Add NEXT_PUBLIC_LOGROCKET_APP_ID to .env
 */
export function LogRocketProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const appId = process.env.NEXT_PUBLIC_LOGROCKET_APP_ID;
    
    if (!appId) {
      console.warn('[LogRocket] App ID not configured - session replay disabled');
      return;
    }

    // Initialize LogRocket
    LogRocket.init(appId, {
      network: {
        requestSanitizer: (request) => {
          // Remove sensitive headers
          if (request.headers?.authorization) {
            request.headers.authorization = '***REDACTED***';
          }
          return request;
        },
      },
      dom: {
        // Don't record input values (privacy)
        inputSanitizer: true,
      },
    });

    // Identify user if authenticated
    const identifyUser = () => {
      // This will be called when user logs in
      // See: src/context/AuthContext.tsx
    };

    console.log('[LogRocket] Initialized successfully');
  }, []);

  return <>{children}</>;
}

/**
 * Helper to identify logged-in users in LogRocket
 * Call this after successful login
 */
export const identifyLogRocketUser = (user: {
  id: string;
  email?: string;
  name?: string;
}) => {
  if (process.env.NEXT_PUBLIC_LOGROCKET_APP_ID) {
    const traits: Record<string, string | number | boolean> = {
      email: user.email || '',
      name: user.name || '',
    };
    
    LogRocket.identify(user.id, traits);
  }
};

/**
 * Helper to log custom events
 */
export const logLogRocketEvent = (event: string, data?: Record<string, any>) => {
  if (process.env.NEXT_PUBLIC_LOGROCKET_APP_ID) {
    LogRocket.track(event, data);
  }
};
