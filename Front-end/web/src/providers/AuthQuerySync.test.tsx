import { renderHook, waitFor, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { QueryProvider } from './QueryProvider';
import AuthQuerySync from './AuthQuerySync';
import { useCampaign } from '@/hooks/queries/useCampaign';
import { AUTH_LOGIN_EVENT, AUTH_LOGOUT_EVENT } from '@/lib/api-client';

jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));
import apiClient from '@/lib/api';

/** The real provider — proves the sync is wired in by construction, not just importable. */
const wrapper = ({ children }: { children: ReactNode }) => <QueryProvider>{children}</QueryProvider>;

/** An explicit client, for the tests that need to inspect the cache itself. */
function withClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const w = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <AuthQuerySync />
      {children}
    </QueryClientProvider>
  );
  return { client, wrapper: w };
}

const status = (eligible: boolean) => ({
  success: true,
  campaign: { slug: 'festive-2026', name: 'Festive', eligible, tiers: [] },
});

/**
 * The bug: campaign eligibility is a PER-USER answer cached under a key that says
 * nothing about the user. Signing in left the guest's `eligible: false` in place for
 * its full staleTime, so the reward ribbon only appeared after a hard reload.
 */
describe('AuthQuerySync', () => {
  beforeEach(() => jest.clearAllMocks());

  it('re-asks a per-user query as soon as the customer signs in', async () => {
    (apiClient.get as jest.Mock)
      .mockResolvedValueOnce(status(false)) // asked as a guest
      .mockResolvedValueOnce(status(true)); // asked again, now signed in

    const { result } = renderHook(() => useCampaign(0), { wrapper });
    await waitFor(() => expect(result.current.data?.eligible).toBe(false));

    act(() => {
      window.dispatchEvent(new CustomEvent(AUTH_LOGIN_EVENT));
    });

    // No remount, no reload — the value on screen changes on its own.
    await waitFor(() => expect(result.current.data?.eligible).toBe(true));
    expect(apiClient.get).toHaveBeenCalledTimes(2);
  });

  it('does not blank the screen while the post-login refetch is in flight', async () => {
    /*
      Invalidate, not reset. Both re-ask the server; only one keeps the answer on screen
      meanwhile. Resetting would flick a correct ribbon (or wishlist count) to empty and
      back for the width of a round trip, which reads as a glitch at the exact moment the
      customer is being told their reward is active.
    */
    (apiClient.get as jest.Mock).mockResolvedValue(status(true));
    const { wrapper: w } = withClient();

    const { result } = renderHook(() => useCampaign(0), { wrapper: w });
    await waitFor(() => expect(result.current.data?.eligible).toBe(true));

    act(() => {
      window.dispatchEvent(new CustomEvent(AUTH_LOGIN_EVENT));
    });

    // Synchronously after the event, before any refetch can have landed.
    expect(result.current.data?.eligible).toBe(true);
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(2));
  });

  it('forgets the previous account entirely on sign-out', async () => {
    /*
      Stale is not enough. Anything left behind is data belonging to the person who just
      signed out, and the next component to mount would read it straight out of the cache
      and render it to whoever is at the keyboard next. Signing out has to actually forget.
    */
    (apiClient.get as jest.Mock).mockResolvedValue(status(true));
    const { client, wrapper: w } = withClient();

    const { result } = renderHook(() => useCampaign(0), { wrapper: w });
    await waitFor(() => expect(result.current.data?.eligible).toBe(true));
    expect(client.getQueryCache().getAll().length).toBeGreaterThan(0);

    act(() => {
      window.dispatchEvent(new CustomEvent(AUTH_LOGOUT_EVENT));
    });

    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });

  it('stops listening once unmounted', async () => {
    (apiClient.get as jest.Mock).mockResolvedValue(status(false));
    const { result, unmount } = renderHook(() => useCampaign(0), { wrapper });
    await waitFor(() => expect(result.current.data?.eligible).toBe(false));
    unmount();

    act(() => {
      window.dispatchEvent(new CustomEvent(AUTH_LOGIN_EVENT));
    });
    expect(apiClient.get).toHaveBeenCalledTimes(1);
  });
});
