import { useState, useEffect } from 'react';

/**
 * Custom hook to handle rate limit timer functionality
 * @param resetTime - Timestamp when rate limit resets
 * @returns timeUntilRetry - Seconds until retry is allowed
 */
export function useRateLimitTimer(resetTime: number | null) {
  const [timeUntilRetry, setTimeUntilRetry] = useState<number | null>(null);
  
  useEffect(() => {
    let timer: NodeJS.Timeout;
    
    if (resetTime) {
      const updateTimer = () => {
        const now = Date.now();
        const remaining = Math.max(0, Math.floor((resetTime - now) / 1000));
        
        setTimeUntilRetry(remaining);
        
        if (remaining > 0) {
          timer = setTimeout(updateTimer, 1000);
        }
      };
      
      updateTimer();
    }
    
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [resetTime]);
  
  return timeUntilRetry;
}