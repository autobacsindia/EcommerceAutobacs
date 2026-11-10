import { act, render } from '@testing-library/react';
import posthog from 'posthog-js';
import { PostHogProvider } from './PostHogProvider';

jest.mock('posthog-js', () => ({
  __esModule: true,
  default: { __loaded: false, init: jest.fn(), capture: jest.fn() },
}));
jest.mock('next/navigation', () => ({
  usePathname: () => '/products',
  useSearchParams: () => new URLSearchParams(),
}));

const init = posthog.init as jest.Mock;

/** Pretend the page is still waiting for its slowest script or picture. */
const setPageState = (state: DocumentReadyState) =>
  Object.defineProperty(document, 'readyState', { configurable: true, get: () => state });

describe('PostHogProvider start-up timing', () => {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;

  beforeEach(() => {
    jest.useFakeTimers();
    init.mockClear();
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'test-key';
    setPageState('loading');
  });

  afterEach(() => {
    jest.useRealTimers();
    process.env.NEXT_PUBLIC_POSTHOG_KEY = key;
    Reflect.deleteProperty(document, 'readyState');
  });

  it('does not start straight away, so it cannot compete with the first pictures', () => {
    render(<PostHogProvider><p>page</p></PostHogProvider>);
    act(() => { jest.advanceTimersByTime(3999); });
    expect(init).not.toHaveBeenCalled();
  });

  it('starts after 4 seconds even when the page has not finished loading', () => {
    render(<PostHogProvider><p>page</p></PostHogProvider>);
    act(() => { jest.advanceTimersByTime(4000); });
    expect(init).toHaveBeenCalledTimes(1);
  });

  it('starts soon after load when the page loads quickly', () => {
    render(<PostHogProvider><p>page</p></PostHogProvider>);
    act(() => { jest.advanceTimersByTime(500); });
    setPageState('complete');
    act(() => { window.dispatchEvent(new Event('load')); jest.advanceTimersByTime(1500); });
    expect(init).toHaveBeenCalledTimes(1);
  });

  it('starts only once when both the load and the 4 second limit happen', () => {
    render(<PostHogProvider><p>page</p></PostHogProvider>);
    act(() => { jest.advanceTimersByTime(3000); });
    act(() => { window.dispatchEvent(new Event('load')); jest.advanceTimersByTime(10000); });
    expect(init).toHaveBeenCalledTimes(1);
  });

  it('never starts once the provider has gone away', () => {
    const { unmount } = render(<PostHogProvider><p>page</p></PostHogProvider>);
    unmount();
    act(() => { window.dispatchEvent(new Event('load')); jest.advanceTimersByTime(10000); });
    expect(init).not.toHaveBeenCalled();
  });

  it('does nothing without a key', () => {
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    render(<PostHogProvider><p>page</p></PostHogProvider>);
    act(() => { jest.advanceTimersByTime(10000); });
    expect(init).not.toHaveBeenCalled();
  });
});
