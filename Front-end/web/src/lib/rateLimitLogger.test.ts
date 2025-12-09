import rateLimitLogger from './rateLimitLogger';

describe('RateLimitLogger', () => {
  beforeEach(() => {
    // Clear events before each test
    rateLimitLogger.clearEvents();
  });

  describe('logEvent', () => {
    it('should log a rate limit event', () => {
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      const endpoint = '/api/test';
      const retryAfter = 5;
      const ipAddress = '192.168.1.1';

      rateLimitLogger.logEvent(endpoint, retryAfter, ipAddress);

      const events = rateLimitLogger['events'];
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        endpoint,
        retryAfter,
        ipAddress
      });
      
      // Check that it logs to console
      expect(consoleLogSpy).toHaveBeenCalledWith('[Rate Limit Event]', expect.objectContaining({
        endpoint,
        retryAfter
      }));

      consoleLogSpy.mockRestore();
    });

    it('should limit stored events to MAX_EVENTS', () => {
      // Add more events than the maximum
      for (let i = 0; i < 1010; i++) {
        rateLimitLogger.logEvent(`/api/test${i}`, 5);
      }

      const events = rateLimitLogger['events'];
      expect(events).toHaveLength(1000);
      
      // Most recent event should be first
      expect(events[0].endpoint).toBe('/api/test1009');
    });
  });

  describe('getRecentEvents', () => {
    it('should return events from the last 60 minutes by default', () => {
      // Mock Date.now to control timestamps
      const now = Date.now();
      jest.spyOn(global.Date, 'now').mockImplementation(() => now);

      // Add events at different times
      rateLimitLogger.logEvent('/api/old', 5);
      
      // Move time forward by 30 minutes
      jest.spyOn(global.Date, 'now').mockImplementation(() => now + 30 * 60 * 1000);
      rateLimitLogger.logEvent('/api/recent', 3);
      
      // Move time forward by another 45 minutes (75 minutes total)
      jest.spyOn(global.Date, 'now').mockImplementation(() => now + 75 * 60 * 1000);
      rateLimitLogger.logEvent('/api/new', 2);

      // Get recent events (last 60 minutes)
      const recentEvents = rateLimitLogger.getRecentEvents();
      
      // Should only include recent and new events, not the old one
      expect(recentEvents).toHaveLength(2);
      expect(recentEvents[0].endpoint).toBe('/api/new');
      expect(recentEvents[1].endpoint).toBe('/api/recent');

      // Restore Date.now
      (global.Date.now as jest.Mock).mockRestore();
    });

    it('should return events from specified time period', () => {
      // Mock Date.now to control timestamps
      const now = Date.now();
      jest.spyOn(global.Date, 'now').mockImplementation(() => now);

      // Add events at different times
      rateLimitLogger.logEvent('/api/old', 5);
      
      // Move time forward by 10 minutes
      jest.spyOn(global.Date, 'now').mockImplementation(() => now + 10 * 60 * 1000);
      rateLimitLogger.logEvent('/api/recent', 3);
      
      // Move time forward by another 20 minutes (30 minutes total)
      jest.spyOn(global.Date, 'now').mockImplementation(() => now + 30 * 60 * 1000);
      rateLimitLogger.logEvent('/api/new', 2);

      // Get recent events (last 15 minutes)
      const recentEvents = rateLimitLogger.getRecentEvents(15);
      
      // Should only include the newest event
      expect(recentEvents).toHaveLength(1);
      expect(recentEvents[0].endpoint).toBe('/api/new');

      // Restore Date.now
      (global.Date.now as jest.Mock).mockRestore();
    });
  });

  describe('getStatistics', () => {
    it('should calculate correct statistics', () => {
      // Mock Date.now to control timestamps
      const now = Date.now();
      jest.spyOn(global.Date, 'now').mockImplementation(() => now);

      // Add events
      rateLimitLogger.logEvent('/api/products', 5);
      rateLimitLogger.logEvent('/api/products', 3);
      rateLimitLogger.logEvent('/api/users', 10);
      rateLimitLogger.logEvent('/api/orders', 7);
      
      // Move time forward by 90 minutes to make events older
      jest.spyOn(global.Date, 'now').mockImplementation(() => now + 90 * 60 * 1000);
      
      // Add more recent events
      rateLimitLogger.logEvent('/api/products', 2);
      rateLimitLogger.logEvent('/api/users', 4);

      const stats = rateLimitLogger.getStatistics();
      
      expect(stats.totalEvents).toBe(2); // Only recent events
      expect(stats.eventsByEndpoint).toEqual({
        '/api/products': 1,
        '/api/users': 1
      });
      expect(stats.averageRetryAfter).toBeCloseTo(3); // (2 + 4) / 2

      // Restore Date.now
      (global.Date.now as jest.Mock).mockRestore();
    });
  });

  describe('clearEvents', () => {
    it('should clear all events', () => {
      rateLimitLogger.logEvent('/api/test1', 5);
      rateLimitLogger.logEvent('/api/test2', 3);
      
      expect(rateLimitLogger['events']).toHaveLength(2);
      
      rateLimitLogger.clearEvents();
      
      expect(rateLimitLogger['events']).toHaveLength(0);
    });
  });
});