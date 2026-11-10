const posthogMock = { __loaded: false, capture: jest.fn(), identify: jest.fn(), reset: jest.fn() };
jest.mock('posthog-js', () => ({ __esModule: true, default: posthogMock }));

import { capture, identifyUser, flushWaitingAnalytics } from './analytics';

describe('events sent before PostHog has started', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'test-key';
    posthogMock.__loaded = false;
    jest.clearAllMocks();
  });
  afterAll(() => { delete process.env.NEXT_PUBLIC_POSTHOG_KEY; });

  it('waits, then sends in order and only once', () => {
    capture('add_to_cart', { id: 1 });
    capture('begin_checkout');
    expect(posthogMock.capture).not.toHaveBeenCalled();
    posthogMock.__loaded = true;
    flushWaitingAnalytics();
    flushWaitingAnalytics();
    expect(posthogMock.capture.mock.calls).toEqual([['add_to_cart', { id: 1 }], ['begin_checkout', undefined]]);
  });

  it('sends straight away once started', () => {
    posthogMock.__loaded = true;
    capture('search');
    expect(posthogMock.capture).toHaveBeenCalledTimes(1);
  });

  it('does nothing when PostHog is not set up', () => {
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    capture('search');
    posthogMock.__loaded = true;
    flushWaitingAnalytics();
    expect(posthogMock.capture).not.toHaveBeenCalled();
  });

  it('keeps the wait list bounded if PostHog never starts', () => {
    for (let i = 0; i < 80; i++) capture('e');
    posthogMock.__loaded = true;
    flushWaitingAnalytics();
    expect(posthogMock.capture.mock.calls.length).toBeLessThanOrEqual(50);
  });
});
