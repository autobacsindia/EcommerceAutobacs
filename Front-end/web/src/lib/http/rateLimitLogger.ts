// Tracks 429 rate-limit events for monitoring and analytics

interface RateLimitEvent {
  timestamp: number;
  endpoint: string;
  retryAfter: number;
  userAgent: string;
  ipAddress?: string;
}

class RateLimitLogger {
  private events: RateLimitEvent[] = [];
  private readonly MAX_EVENTS = 1000;

  logEvent(endpoint: string, retryAfter: number, ipAddress?: string) {
    const event: RateLimitEvent = {
      timestamp: Date.now(),
      endpoint,
      retryAfter,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown',
      ipAddress,
    };

    this.events.unshift(event);
    if (this.events.length > this.MAX_EVENTS) {
      this.events = this.events.slice(0, this.MAX_EVENTS);
    }

    if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
      console.log('[Rate Limit Event]', {
        endpoint,
        retryAfter,
        timestamp: new Date(event.timestamp).toISOString(),
        userAgent: event.userAgent,
      });
    }
  }

  getRecentEvents(minutes = 60): RateLimitEvent[] {
    const cutoff = Date.now() - minutes * 60 * 1000;
    return this.events.filter(e => e.timestamp >= cutoff);
  }

  getStatistics(minutes = 60): {
    totalEvents: number;
    eventsByEndpoint: Record<string, number>;
    averageRetryAfter: number;
  } {
    const recent = this.getRecentEvents(minutes);
    const eventsByEndpoint: Record<string, number> = {};
    let totalRetryAfter = 0;
    for (const e of recent) {
      eventsByEndpoint[e.endpoint] = (eventsByEndpoint[e.endpoint] || 0) + 1;
      totalRetryAfter += e.retryAfter;
    }
    return {
      totalEvents: recent.length,
      eventsByEndpoint,
      averageRetryAfter: recent.length > 0 ? totalRetryAfter / recent.length : 0,
    };
  }

  clearEvents() {
    this.events = [];
  }
}

const rateLimitLogger = new RateLimitLogger();
export default rateLimitLogger;
