import { act, render } from '@testing-library/react';
import posthog from 'posthog-js';
import { PostHogProvider } from './PostHogProvider';
import * as loader from '@/lib/posthogLoader';

jest.mock('posthog-js', () => ({
  __esModule: true,
  default: { __loaded: false, init: jest.fn(), capture: jest.fn() },
}));
jest.mock('next/navigation', () => ({
  usePathname: () => '/products',
  useSearchParams: () => new URLSearchParams(),
}));

const init = posthog.init as jest.Mock;

/** The library arrives by dynamic import(): let that promise settle. */
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

/** Pretend the page is still waiting for its slowest script or picture. */
const setPageState = (state: DocumentReadyState) =>
  Object.defineProperty(document, 'readyState', { configurable: true, get: () => state });

describe('PostHogProvider start-up timing', () => {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;

  beforeEach(() => {
    jest.useFakeTimers();
    init.mockClear();
    loader.__resetPostHogLoader();
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'test-key';
    setPageState('loading');
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    process.env.NEXT_PUBLIC_POSTHOG_KEY = key;
    Reflect.deleteProperty(document, 'readyState');
  });

  it('does not start straight away, so it cannot compete with the first pictures', async () => {
    render(<PostHogProvider><p>page</p></PostHogProvider>);
    act(() => { jest.advanceTimersByTime(3999); });
    await settle();
    expect(init).not.toHaveBeenCalled();
  });

  it('starts after 4 seconds even when the page has not finished loading', async () => {
    render(<PostHogProvider><p>page</p></PostHogProvider>);
    act(() => { jest.advanceTimersByTime(4000); });
    await settle();
    expect(init).toHaveBeenCalledTimes(1);
  });

  it('starts soon after load when the page loads quickly', async () => {
    render(<PostHogProvider><p>page</p></PostHogProvider>);
    act(() => { jest.advanceTimersByTime(500); });
    setPageState('complete');
    act(() => { window.dispatchEvent(new Event('load')); jest.advanceTimersByTime(1500); });
    await settle();
    expect(init).toHaveBeenCalledTimes(1);
  });

  it('starts only once when both the load and the 4 second limit happen', async () => {
    render(<PostHogProvider><p>page</p></PostHogProvider>);
    act(() => { jest.advanceTimersByTime(3000); });
    act(() => { window.dispatchEvent(new Event('load')); jest.advanceTimersByTime(10000); });
    await settle();
    expect(init).toHaveBeenCalledTimes(1);
  });

  it('never starts once the provider has gone away', async () => {
    const { unmount } = render(<PostHogProvider><p>page</p></PostHogProvider>);
    unmount();
    act(() => { window.dispatchEvent(new Event('load')); jest.advanceTimersByTime(10000); });
    await settle();
    expect(init).not.toHaveBeenCalled();
  });

  it('does nothing without a key', async () => {
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    render(<PostHogProvider><p>page</p></PostHogProvider>);
    act(() => { jest.advanceTimersByTime(10000); });
    await settle();
    expect(init).not.toHaveBeenCalled();
  });

  it('does not even download the PostHog library before it is time to start', async () => {
    const load = jest.spyOn(loader, 'loadPostHog');
    render(<PostHogProvider><p>page</p></PostHogProvider>);
    act(() => { jest.advanceTimersByTime(3999); });
    await settle();
    expect(load).not.toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(1); });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('leaves the page alone when the PostHog file cannot be downloaded', async () => {
    jest.spyOn(loader, 'loadPostHog').mockRejectedValueOnce(new Error('ChunkLoadError'));
    render(<PostHogProvider><p>page</p></PostHogProvider>);
    act(() => { jest.advanceTimersByTime(4000); });
    await settle();
    expect(init).not.toHaveBeenCalled();
  });
});
