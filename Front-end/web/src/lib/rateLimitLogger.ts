// Rate Limit Logger Utility
// Tracks rate limiting events for monitoring and analytics

interface RateLimitEvent {
  timestamp: number;
  endpoint: string;
  retryAfter: number;
  userAgent: string;
  ipAddress?: string;
}

class RateLimitLogger {
  private events: RateLimitEvent[] = [];
  private readonly MAX_EVENTS = 1000; // Limit stored events to prevent memory issues

  // Log a rate limiting event
  logEvent(endpoint: string, retryAfter: number, ipAddress?: string) {
    const event: RateLimitEvent = {
      timestamp: Date.now(),
      endpoint,
      retryAfter,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown',
      ipAddress
    };

    // Add event to the beginning of the array
    this.events.unshift(event);

    // Trim array if it exceeds maximum size
    if (this.events.length > this.MAX_EVENTS) {
      this.events = this.events.slice(0, this.MAX_EVENTS);
    }

    // Log to console for development (but not in test)
    if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
      console.log('[Rate Limit Event]', {
        endpoint,
        retryAfter,
        timestamp: new Date(event.timestamp).toISOString(),
        userAgent: event.userAgent
      });
    }

    // In a production environment, you might send this data to your analytics service
    // Example:
    // if (process.env.NODE_ENV === 'production') {
    //   this.sendToAnalytics(event);
    // }
  }

  // Get recent events
  getRecentEvents(minutes: number = 60): RateLimitEvent[] {
    const cutoffTime = Date.now() - (minutes * 60 * 1000);
    return this.events.filter(event => event.timestamp >= cutoffTime);
  }

  // Get statistics about rate limiting events
  getStatistics(minutes: number = 60): {
    totalEvents: number;
    eventsByEndpoint: Record<string, number>;
    averageRetryAfter: number;
  } {
    const recentEvents = this.getRecentEvents(minutes);
    
    const eventsByEndpoint: Record<string, number> = {};
    let totalRetryAfter = 0;

    recentEvents.forEach(event => {
      eventsByEndpoint[event.endpoint] = (eventsByEndpoint[event.endpoint] || 0) + 1;
      totalRetryAfter += event.retryAfter;
    });

    return {
      totalEvents: recentEvents.length,
      eventsByEndpoint,
      averageRetryAfter: recentEvents.length > 0 ? totalRetryAfter / recentEvents.length : 0
    };
  }

  // Clear all events
  clearEvents() {
    this.events = [];
  }

  // Send event data to analytics service (example implementation)
  private async sendToAnalytics(event: RateLimitEvent) {
    try {
      // This is where you would integrate with your analytics service
      // For example, sending to Google Analytics, Mixpanel, etc.
      /*
      await fetch('/api/analytics/rate-limit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(event)
      });
      */
    } catch (error) {
      console.error('Failed to send rate limit event to analytics:', error);
    }
  }
}

// Export singleton instance
const rateLimitLogger = new RateLimitLogger();

export default rateLimitLogger;