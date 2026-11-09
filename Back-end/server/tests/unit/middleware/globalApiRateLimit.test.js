import { jest } from '@jest/globals';

const { createGlobalApiRateLimit, isBackgroundPoll } = await import(
  '../../../middleware/rate-limit/apiLimiters.js'
);

describe('global API rate limit buckets', () => {
  const dispatch = (req) => {
    const site = jest.fn();
    const poll = jest.fn();
    createGlobalApiRateLimit(site, poll)(req, {}, jest.fn());
    return { site: site.mock.calls.length, poll: poll.mock.calls.length };
  };

  test.each(['/notifications/summary', '/chat/channels'])(
    'timer-driven GET %s spends the poll bucket, not the site bucket',
    (path) => {
      expect(dispatch({ method: 'GET', path })).toEqual({ site: 0, poll: 1 });
    },
  );

  test.each([
    ['GET', '/products'],
    ['GET', '/categories'],
    ['GET', '/chat/channels/abc/messages'],
    ['POST', '/chat/channels'],
    ['POST', '/auth/login'],
    ['POST', '/checkout/quote'],
  ])('%s %s stays in the site bucket', (method, path) => {
    expect(dispatch({ method, path })).toEqual({ site: 1, poll: 0 });
    expect(isBackgroundPoll({ method, path })).toBe(false);
  });
});
