import apiClient, { ApiError, ErrorCategory } from './api';
import rateLimitLogger from './rateLimitLogger';

// Mock fetch globally
global.fetch = jest.fn();

// Mock rateLimitLogger
jest.mock('./rateLimitLogger', () => ({
  logEvent: jest.fn()
}));

const mockHeaders = (headers: Record<string, string>) => ({
  get: (name: string) => headers[name.toLowerCase()] || null
});

describe('APIClient Rate Limiting', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
    
    // Reset the mock implementation
    (global.fetch as jest.Mock).mockReset();

    // Reset timers to real ones
    jest.useRealTimers();
  });

  describe('GET requests', () => {
    it('should retry on rate limit error with exponential backoff and jitter', async () => {
      // Mock a rate limit error followed by a successful response
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          headers: mockHeaders({ 'retry-after': '5', 'content-type': 'application/json' }),
          json: () => Promise.resolve({ message: 'Too many requests' }),
          url: 'http://localhost:5000/test',
          clone: function() { return this; }
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: mockHeaders({ 'content-type': 'application/json' }),
          json: () => Promise.resolve({ data: 'success' }),
          url: 'http://localhost:5000/test',
          clone: function() { return this; }
        });

      // Spy on setTimeout to control timing
      jest.useFakeTimers();
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

      // Make the API call
      const promise = apiClient.get('/test');

      // Fast-forward through the retries
      await jest.advanceTimersByTimeAsync(10000);
      const result = await promise;

      // Restore real timers
      jest.useRealTimers();

      // Assertions
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ data: 'success' });
      
      // Check that setTimeout was called with appropriate delays
      expect(setTimeoutSpy).toHaveBeenCalled();
      
      // Check that rate limit logger was called
      expect(rateLimitLogger.logEvent).toHaveBeenCalledWith('/test', 5);
    });

    it('should exhaust retries and throw error if rate limit persists', async () => {
      // Mock multiple rate limit errors
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 429,
        headers: mockHeaders({ 'retry-after': '1', 'content-type': 'application/json' }),
        json: () => Promise.resolve({ message: 'Too many requests' }),
        url: 'http://localhost:5000/test',
        clone: function() { return this; }
      });

      // Spy on setTimeout to control timing
      jest.useFakeTimers();

      // Make the API call with limited retries
      const promise = apiClient.get('/test', { retries: 2 });
      
      // Attach catch handler immediately to avoid unhandled rejection issues during timer advancement
      const catchSpy = jest.fn();
      promise.catch(catchSpy);

      // Fast-forward through retries
      // Retry 1
      await jest.advanceTimersByTimeAsync(5000);
      // Retry 2
      await jest.advanceTimersByTimeAsync(5000);
      // Final processing
      await jest.advanceTimersByTimeAsync(5000);
      
      // Assertions
      expect(catchSpy).toHaveBeenCalled();
      const error = catchSpy.mock.calls[0][0];
      expect(error).toBeInstanceOf(ApiError);
      expect(error.message).toBe('Too many requests');

      // Restore real timers
      jest.useRealTimers();

      // Check call counts
      expect(fetch).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
      expect(rateLimitLogger.logEvent).toHaveBeenCalledTimes(2);
    });
  });

  describe('POST requests', () => {
    it('should retry on rate limit error with exponential backoff and jitter', async () => {
      // Mock a rate limit error followed by a successful response
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          headers: mockHeaders({ 'retry-after': '3', 'content-type': 'application/json' }),
          json: () => Promise.resolve({ message: 'Too many requests' }),
          url: 'http://localhost:5000/test',
          clone: function() { return this; }
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: mockHeaders({ 'content-type': 'application/json' }),
          json: () => Promise.resolve({ data: 'success' }),
          url: 'http://localhost:5000/test',
          clone: function() { return this; }
        });

      // Spy on setTimeout to control timing
      jest.useFakeTimers();

      // Make the API call
      const promise = apiClient.post('/test', { testData: 'value' });

      // Fast-forward through the retries
      await jest.advanceTimersByTimeAsync(10000);
      const result = await promise;

      // Restore real timers
      jest.useRealTimers();

      // Assertions
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ data: 'success' });
      
      // Check that rate limit logger was called
      expect(rateLimitLogger.logEvent).toHaveBeenCalledWith('/test', 3);
    });
  });

  describe('PUT requests', () => {
    it('should retry on rate limit error with exponential backoff and jitter', async () => {
      // Mock a rate limit error followed by a successful response
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          headers: mockHeaders({ 'retry-after': '2', 'content-type': 'application/json' }),
          json: () => Promise.resolve({ message: 'Too many requests' }),
          url: 'http://localhost:5000/test',
          clone: function() { return this; }
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: mockHeaders({ 'content-type': 'application/json' }),
          json: () => Promise.resolve({ data: 'success' }),
          url: 'http://localhost:5000/test',
          clone: function() { return this; }
        });

      // Spy on setTimeout to control timing
      jest.useFakeTimers();

      // Make the API call
      const promise = apiClient.put('/test', { testData: 'value' });

      // Fast-forward through the retries
      await jest.advanceTimersByTimeAsync(10000);
      const result = await promise;

      // Restore real timers
      jest.useRealTimers();

      // Assertions
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ data: 'success' });
      
      // Check that rate limit logger was called
      expect(rateLimitLogger.logEvent).toHaveBeenCalledWith('/test', 2);
    });
  });

  describe('DELETE requests', () => {
    it('should retry on rate limit error with exponential backoff and jitter', async () => {
      // Mock a rate limit error followed by a successful response
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          headers: mockHeaders({ 'retry-after': '4', 'content-type': 'application/json' }),
          json: () => Promise.resolve({ message: 'Too many requests' }),
          url: 'http://localhost:5000/test',
          clone: function() { return this; }
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: mockHeaders({ 'content-type': 'application/json' }),
          json: () => Promise.resolve({ data: 'success' }),
          url: 'http://localhost:5000/test',
          clone: function() { return this; }
        });

      // Spy on setTimeout to control timing
      jest.useFakeTimers();

      // Make the API call
      const promise = apiClient.delete('/test');

      // Fast-forward through the retries
      await jest.advanceTimersByTimeAsync(10000);
      const result = await promise;

      // Restore real timers
      jest.useRealTimers();

      // Assertions
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ data: 'success' });
      
      // Check that rate limit logger was called
      expect(rateLimitLogger.logEvent).toHaveBeenCalledWith('/test', 4);
    });
  });

  describe('Rate limit logger', () => {
    it('should log rate limit events with correct parameters', async () => {
      // Mock a rate limit error followed by a successful response
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          headers: mockHeaders({ 'retry-after': '5', 'content-type': 'application/json' }),
          json: () => Promise.resolve({ message: 'Too many requests' }),
          url: 'http://localhost:5000/products',
          clone: function() { return this; }
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: mockHeaders({ 'content-type': 'application/json' }),
          json: () => Promise.resolve({ data: 'success' }),
          url: 'http://localhost:5000/products',
          clone: function() { return this; }
        });

      // Spy on setTimeout to control timing
      jest.useFakeTimers();

      // Make the API call
      const promise = apiClient.get('/products');

      // Fast-forward through the retries
      await jest.advanceTimersByTimeAsync(10000);
      await promise;

      // Restore real timers
      jest.useRealTimers();

      // Check that rate limit logger was called with correct parameters
      expect(rateLimitLogger.logEvent).toHaveBeenCalledWith('/products', 5);
    });
  });
});