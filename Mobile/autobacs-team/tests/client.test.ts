import { ApiError, createHttp, errorMessage, type TokenPair, type TokenStore } from '../src/api/http';

/** The ApiError a call rejected with (fails the test if it resolved). */
const failure = (p: Promise<unknown>): Promise<ApiError> =>
  p.then(
    () => {
      throw new Error('expected the call to fail');
    },
    (e: ApiError) => e,
  );

type Reply = { status: number; body?: unknown; raw?: string } | 'network';

function harness(replies: Record<string, Reply[]>, start: Partial<TokenPair> = {}) {
  let saved: TokenPair = { accessToken: null, refreshToken: null, signedIn: false, ...start };
  const tokens: TokenStore = { load: async () => saved, save: async (p) => void (saved = p) };
  const calls: { path: string; method: string; headers: Record<string, string>; credentials?: string; body?: string }[] = [];
  const fetchFn = (async (url: string, init: RequestInit = {}) => {
    const path = url.replace('https://api.test/api/v1', '');
    calls.push({
      path,
      method: (init.method as string) ?? 'GET',
      headers: (init.headers ?? {}) as Record<string, string>,
      credentials: init.credentials as string | undefined,
      body: init.body as string | undefined,
    });
    const queue = replies[path] ?? [];
    const r = queue.length > 1 ? queue.shift()! : queue[0];
    if (!r) throw new Error(`unexpected call ${path}`);
    if (r === 'network') throw new TypeError('Network request failed');
    const text = r.raw ?? (r.body === undefined ? '' : JSON.stringify(r.body));
    return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => text, json: async () => JSON.parse(text) } as Response;
  }) as unknown as typeof fetch;
  const signedOut = jest.fn();
  const http = createHttp({ baseUrl: 'https://api.test/api/v1', fetch: fetchFn, tokens, onSignedOut: signedOut });
  return { http, calls, signedOut, saved: () => saved };
}

describe('API client', () => {
  test('401 → refresh fails → signed out: handler fires, tokens cleared, SIGNED_OUT thrown (never a success)', async () => {
    const h = harness(
      { '/hr/me': [{ status: 401, body: { success: false, message: 'Token expired' } }], '/auth/refresh': [{ status: 401, body: {} }] },
      { accessToken: 'old', refreshToken: 'r1', signedIn: true },
    );
    const err = await failure(h.http.get('/hr/me'));
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
    expect(err.code).toBe('SIGNED_OUT');
    expect(h.signedOut).toHaveBeenCalledTimes(1);
    expect(h.saved()).toEqual({ accessToken: null, refreshToken: null, signedIn: false });
    expect(await h.http.isSignedIn()).toBe(false);
  });

  test('401 → refresh succeeds → request replayed once with the new token', async () => {
    const h = harness(
      {
        '/hr/me': [{ status: 401, body: {} }, { status: 200, body: { employee: { id: 'e1' } } }],
        '/auth/refresh': [{ status: 200, body: { accessToken: 'new', refreshToken: 'r2' } }],
      },
      { accessToken: 'old', refreshToken: 'r1', signedIn: true },
    );
    const r = await h.http.get<{ employee: { id: string } }>('/hr/me');
    expect(r.employee.id).toBe('e1');
    expect(h.signedOut).not.toHaveBeenCalled();
    const me = h.calls.filter((c) => c.path === '/hr/me');
    expect(me.map((c) => c.headers.Authorization)).toEqual(['Bearer old', 'Bearer new']);
    expect(h.saved().refreshToken).toBe('r2');
  });

  test('a second 401 after a good refresh still signs out (no loop)', async () => {
    const h = harness(
      { '/hr/me': [{ status: 401, body: {} }], '/auth/refresh': [{ status: 200, body: {} }] },
      { signedIn: true },
    );
    const err = await failure(h.http.get('/hr/me'));
    expect(err.code).toBe('SIGNED_OUT');
    expect(h.calls.filter((c) => c.path === '/hr/me')).toHaveLength(2);
    expect(h.signedOut).toHaveBeenCalledTimes(1);
  });

  test('parallel 401s share one refresh', async () => {
    const h = harness(
      {
        '/a': [{ status: 401 }, { status: 200, body: { ok: 1 } }],
        '/b': [{ status: 401 }, { status: 200, body: { ok: 2 } }],
        '/auth/refresh': [{ status: 200, body: { accessToken: 'new' } }],
      },
      { accessToken: 'old', signedIn: true },
    );
    await Promise.all([h.http.get('/a'), h.http.get('/b')]);
    expect(h.calls.filter((c) => c.path === '/auth/refresh')).toHaveLength(1);
  });

  test('a wrong password on login is a plain error, not a sign-out', async () => {
    const h = harness({ '/csrf-token': [{ status: 200, body: { csrfToken: 'x' } }], '/auth/login': [{ status: 401, body: { message: 'Invalid email or password' } }] });
    const err = await failure(h.http.request('/auth/login', { method: 'POST', body: {}, noAuthRetry: true }));
    expect(err.status).toBe(401);
    expect(err.message).toBe('Invalid email or password');
    expect(h.signedOut).not.toHaveBeenCalled();
  });

  test('network failure → status 0, offline, transient', async () => {
    const h = harness({ '/hr/me': ['network'] });
    const err = await failure(h.http.get('/hr/me'));
    expect(err.offline).toBe(true);
    expect(err.transient).toBe(true);
  });

  test('an undeployed endpoint ("Route not found") is NOT_AVAILABLE; a real 404 keeps its message', async () => {
    const h = harness({
      '/hr/me/payslips': [{ status: 404, body: { success: false, message: 'Route not found' } }],
      '/hr/me': [{ status: 404, body: { success: false, message: 'Your HR profile is not set up yet' } }],
      '/x': [{ status: 404, raw: '<html>404</html>' }],
    });
    expect((await failure(h.http.get('/hr/me/payslips'))).notAvailable).toBe(true);
    expect((await failure(h.http.get('/x'))).notAvailable).toBe(true);
    const real = await failure(h.http.get('/hr/me'));
    expect(real.notAvailable).toBe(false);
    expect(errorMessage(real)).toBe('Your HR profile is not set up yet');
  });

  test('a 422 refusal carries its reason code and extra fields', async () => {
    const h = harness({
      '/csrf-token': [{ status: 200, body: { csrfToken: 'x' } }],
      '/hr/me/punches': [{ status: 422, body: { success: false, code: 'outside_fence', message: 'You are 900 m away', distanceM: 900 } }],
    });
    const err = await failure(h.http.post('/hr/me/punches', {}));
    expect(err.code).toBe('outside_fence');
    expect(err.extra.distanceM).toBe(900);
    expect(err.transient).toBe(false);
  });

  test('writes send the CSRF token; a bare 403 refetches it and replays once', async () => {
    const h = harness({
      '/csrf-token': [{ status: 200, body: { csrfToken: 'one' } }, { status: 200, body: { csrfToken: 'two' } }],
      '/hr/me/leave': [{ status: 403, body: { message: 'CSRF' } }, { status: 201, body: { request: {} } }],
    });
    await h.http.post('/hr/me/leave', {});
    const writes = h.calls.filter((c) => c.path === '/hr/me/leave');
    expect(writes.map((c) => c.headers['X-XSRF-TOKEN'])).toEqual(['one', 'two']);
  });

  test('5xx and 429 get a plain sentence when the server sends none', async () => {
    const h = harness({ '/a': [{ status: 502, raw: 'Bad gateway' }], '/b': [{ status: 429 }] });
    expect((await failure(h.http.get('/a'))).message).toMatch(/server had a problem/);
    expect((await failure(h.http.get('/b'))).message).toMatch(/Too many tries/);
  });

  describe('Bearer mode (X-Client: autobacs-team)', () => {
    test('every call says it is the app; with a token: no cookie jar, no CSRF fetch', async () => {
      const h = harness({ '/hr/me/leave': [{ status: 201, body: { request: {} } }], '/hr/me': [{ status: 200, body: {} }] }, { accessToken: 'a1', refreshToken: 'r1', signedIn: true });
      await h.http.get('/hr/me');
      await h.http.post('/hr/me/leave', {});
      expect(h.calls.map((c) => c.path)).toEqual(['/hr/me', '/hr/me/leave']); // no /csrf-token
      for (const c of h.calls) {
        expect(c.headers['X-Client']).toBe('autobacs-team');
        expect(c.headers.Authorization).toBe('Bearer a1');
        expect(c.credentials).toBe('omit');
        expect(c.headers['X-XSRF-TOKEN']).toBeUndefined();
      }
    });

    test('refresh sends the stored refresh token in the body, without cookies', async () => {
      const h = harness(
        { '/hr/me': [{ status: 401 }, { status: 200, body: {} }], '/auth/refresh': [{ status: 200, body: { accessToken: 'a2', refreshToken: 'r2' } }] },
        { accessToken: 'a1', refreshToken: 'r1', signedIn: true },
      );
      await h.http.get('/hr/me');
      const r = h.calls.find((c) => c.path === '/auth/refresh')!;
      expect(JSON.parse(r.body!)).toEqual({ refreshToken: 'r1' });
      expect(r.credentials).toBe('omit');
      expect(r.headers['X-Client']).toBe('autobacs-team');
      expect(h.saved()).toMatchObject({ accessToken: 'a2', refreshToken: 'r2' });
    });

    test('logout revokes the refresh token on the server and forgets it, even if the call fails', async () => {
      const ok = harness({ '/auth/logout': [{ status: 200, body: {} }] }, { accessToken: 'a1', refreshToken: 'r1', signedIn: true });
      await ok.http.logout();
      expect(JSON.parse(ok.calls[0].body!)).toEqual({ refreshToken: 'r1' });
      expect(ok.saved()).toEqual({ accessToken: null, refreshToken: null, signedIn: false });

      const offline = harness({ '/auth/logout': ['network'] }, { accessToken: 'a1', refreshToken: 'r1', signedIn: true });
      await expect(offline.http.logout()).rejects.toBeInstanceOf(ApiError);
      expect(offline.saved().accessToken).toBeNull();
    });

    test('authHeader for downloads carries the token and the client header', async () => {
      const h = harness({}, { accessToken: 'a1', signedIn: true });
      expect(await h.http.authHeader()).toEqual({ 'X-Client': 'autobacs-team', Authorization: 'Bearer a1' });
    });

    test('without a token (older cookie-only server) it falls back to cookies + CSRF', async () => {
      const h = harness({ '/csrf-token': [{ status: 200, body: { csrfToken: 'c' } }], '/hr/me/leave': [{ status: 201, body: {} }] }, { signedIn: true });
      await h.http.post('/hr/me/leave', {});
      const w = h.calls.find((c) => c.path === '/hr/me/leave')!;
      expect(w.credentials).toBe('include');
      expect(w.headers['X-XSRF-TOKEN']).toBe('c');
    });
  });
});
