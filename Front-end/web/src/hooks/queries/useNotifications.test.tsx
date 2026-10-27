/**
 * The bell keeps checking while the tab is hidden (slower), so the "new work"
 * sound can play for someone in another tab or app.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { act } from 'react';
import { HIDDEN_POLL_MS, pollInterval, useWaitingWork } from './useNotifications';

const get = jest.fn();
jest.mock('@/lib/api', () => ({ __esModule: true, default: { get: (...a: unknown[]) => get(...a) } }));
jest.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { role: 'admin' } }) }));

let visibility: DocumentVisibilityState = 'visible';
beforeAll(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => visibility === 'hidden' });
});
beforeEach(() => { visibility = 'visible'; get.mockReset().mockResolvedValue({ items: [], total: 0 }); });
afterEach(() => { jest.useRealTimers(); });

it('polls every 20 s in front, every minute when hidden', () => {
  const every = pollInterval(20_000);
  expect(every()).toBe(20_000);
  visibility = 'hidden';
  expect(every()).toBe(HIDDEN_POLL_MS);
});

it('keeps fetching while the tab is hidden', async () => {
  jest.useFakeTimers();
  visibility = 'hidden';
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { unmount } = renderHook(() => useWaitingWork(), { wrapper });
  await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
  await act(async () => { await jest.advanceTimersByTimeAsync(HIDDEN_POLL_MS + 100); });
  expect(get).toHaveBeenCalledTimes(2);
  await act(async () => { await jest.advanceTimersByTimeAsync(HIDDEN_POLL_MS + 100); });
  expect(get).toHaveBeenCalledTimes(3);
  unmount();
  client.clear();
});
