import apiClient, { SESSION_EXPIRED_EVENT } from './api-client';
import { writeAuthCache, hasAuthenticatedSession } from './authStorage';

/**
 * Regression guard for the on401 refresh gate.
 *
 * The bug: api-client treated the mere presence of the `auth_check` localStorage
 * key as "a session existed". A guest's logged-out auth check writes
 * `{ user: null }` under that key, so on a return visit a protected-endpoint 401
 * attempted a doomed token refresh whose failure fired a spurious "session
 * expired" prompt. The gate must key off a non-null cached `user`, not presence.
 */

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    url: 'http://localhost/api/v1/auth/me',
    statusText: status === 401 ? 'Unauthorized' : '',
    headers: {
      get: (h: string) =>
        h.toLowerCase() === 'content-type' ? 'application/json' : null,
    },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe('api-client on401 refresh gate', () => {
  let fetchMock: jest.Mock;
  const realFetch = global.fetch;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('autobacs_session_id', 'sess_test'); // avoid crypto id gen
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});

    // Every request 401s; the refresh endpoint also fails so a real session
    // reaches the expiry path.
    fetchMock = jest.fn((url: string | URL) => {
      const u = String(url);
      if (u.includes('/auth/refresh')) {
        return Promise.resolve(jsonResponse(401, { success: false, message: 'Refresh failed' }));
      }
      return Promise.resolve(jsonResponse(401, { success: false, message: 'Unauthorized' }));
    });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  const refreshWasCalled = () =>
    fetchMock.mock.calls.some(([u]) => String(u).includes('/auth/refresh'));

  it('guest (negative cache) 401 skips refresh and does NOT fire session-expired', async () => {
    writeAuthCache(null, 0); // exactly what a logged-out auth check persists
    const onExpired = jest.fn();
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);

    await expect(apiClient.get('/auth/me')).rejects.toBeDefined();

    expect(refreshWasCalled()).toBe(false);
    expect(onExpired).not.toHaveBeenCalled();

    window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  });

  it('no cache at all: guest 401 skips refresh and does NOT fire session-expired', async () => {
    const onExpired = jest.fn();
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);

    await expect(apiClient.get('/auth/me')).rejects.toBeDefined();

    expect(refreshWasCalled()).toBe(false);
    expect(onExpired).not.toHaveBeenCalled();

    window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  });

  it('real session: 401 attempts refresh and, on refresh failure, fires session-expired once + clears cache', async () => {
    writeAuthCache({ _id: 'u1', role: 'customer' }, 1);
    const onExpired = jest.fn();
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);

    await expect(apiClient.get('/auth/me')).rejects.toBeDefined();

    expect(refreshWasCalled()).toBe(true);
    expect(onExpired).toHaveBeenCalledTimes(1);
    // The unrecoverable session is dropped so it doesn't loop on the next request.
    expect(hasAuthenticatedSession()).toBe(false);

    window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  });
});
