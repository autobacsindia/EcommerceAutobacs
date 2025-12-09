import apiClient, { ApiError, ErrorCategory } from './api';
import rateLimitLogger from './rateLimitLogger';

// Mock fetch globally
global.fetch = jest.fn();

// Mock rateLimitLogger
jest.mock('./rateLimitLogger', () => ({
  logEvent: jest.fn()
}));

describe('APIClient Rate Limiting', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
    
    // Reset the mock implementation
    (global.fetch as jest.Mock).mockReset();
  });

  describe('GET requests', () => {
    it('should retry on rate limit error with exponential backoff and jitter', async () => {
      // Mock a rate limit error followed by a successful response
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          headers: new Map([['retry-after', '5']]),
          json: () => Promise.resolve({ message: 'Too many requests' }),
          url: 'http://localhost:5000/test'
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: 'success' }),
          url: 'http://localhost:5000/test'
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
        headers: new Map([['retry-after', '5']]),
        json: () => Promise.resolve({ message: 'Too many requests' }),
        url: 'http://localhost:5000/test'
      });

      // Spy on setTimeout to control timing
      jest.useFakeTimers();

      // Make the API call
      const promise = apiClient.get('/test');

      // Fast-forward through all retries
      await jest.advanceTimersByTimeAsync(60000);
      
      // Expect the promise to reject
      await expect(promise).rejects.toThrow('Too many requests');

      // Restore real timers
      jest.useRealTimers();

      // Assertions
      // Should have tried 4 times (1 initial + 3 retries)
      expect(fetch).toHaveBeenCalledTimes(4);
      
      // Check that rate limit logger was called for each retry attempt
      expect(rateLimitLogger.logEvent).toHaveBeenCalledTimes(3);
    });
  });

  describe('POST requests', () => {
    it('should retry on rate limit error with exponential backoff and jitter', async () => {
      // Mock a rate limit error followed by a successful response
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          headers: new Map([['retry-after', '3']]),
          json: () => Promise.resolve({ message: 'Too many requests' }),
          url: 'http://localhost:5000/test'
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: 'success' }),
          url: 'http://localhost:5000/test'
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
          headers: new Map([['retry-after', '2']]),
          json: () => Promise.resolve({ message: 'Too many requests' }),
          url: 'http://localhost:5000/test'
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: 'success' }),
          url: 'http://localhost:5000/test'
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
          headers: new Map([['retry-after', '4']]),
          json: () => Promise.resolve({ message: 'Too many requests' }),
          url: 'http://localhost:5000/test'
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: 'success' }),
          url: 'http://localhost:5000/test'
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
          headers: new Map([['retry-after', '5']]),
          json: () => Promise.resolve({ message: 'Too many requests' }),
          url: 'http://localhost:5000/products'
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: 'success' }),
          url: 'http://localhost:5000/products'
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