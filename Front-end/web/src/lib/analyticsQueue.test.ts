const posthogMock = { __loaded: false, capture: jest.fn(), identify: jest.fn(), reset: jest.fn() };
jest.mock('posthog-js', () => ({ __esModule: true, default: posthogMock }));

import { capture, identifyUser, flushWaitingAnalytics } from './analytics';
import { loadPostHog, __resetPostHogLoader } from './posthogLoader';

describe('events sent before PostHog has started', () => {
  beforeEach(async () => {
    __resetPostHogLoader();
    await loadPostHog(); // the library is fetched; whether it has STARTED is __loaded
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

  it('keeps waiting while the PostHog file itself is still downloading', async () => {
    __resetPostHogLoader(); // nothing fetched yet: the state of every page for its first seconds
    posthogMock.__loaded = true;
    capture('add_to_cart', { id: 2 });
    flushWaitingAnalytics();
    expect(posthogMock.capture).not.toHaveBeenCalled();

    await loadPostHog();
    flushWaitingAnalytics();
    expect(posthogMock.capture.mock.calls).toEqual([['add_to_cart', { id: 2 }]]);
  });

  it('sends with the client PostHog hands to its loaded callback', () => {
    capture('search');
    const client = { ...posthogMock, capture: jest.fn() };
    flushWaitingAnalytics(client as never);
    expect(client.capture).toHaveBeenCalledWith('search', undefined);
  });
});
