import apiClient, { isLoadingBarRequest } from './api-client';

/**
 * The top-of-page loading bar (GlobalLoadingBar) must light only for writes the
 * person started. Background reads — the bell every 20 s, the chat list, live
 * calls — used to light it too, so an idle panel page flashed "loading" every
 * ~10 s (measured on /admin/orders: 3 flashes in 40 s).
 */

function okResponse(): Response {
  return {
    ok: true,
    status: 200,
    url: 'http://localhost/api/v1/x',
    statusText: '',
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => ({ success: true }),
    text: async () => '{"success":true}',
  } as unknown as Response;
}

describe('isLoadingBarRequest', () => {
  it.each(['GET', 'get', 'HEAD'])('%s never lights the bar', (m) => {
    expect(isLoadingBarRequest(m)).toBe(false);
    expect(isLoadingBarRequest(m, { background: false })).toBe(false);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('%s lights the bar unless marked background', (m) => {
    expect(isLoadingBarRequest(m)).toBe(true);
    expect(isLoadingBarRequest(m, {})).toBe(true);
    expect(isLoadingBarRequest(m, { background: true })).toBe(false);
  });
});

describe('api-client loading listener', () => {
  const realFetch = global.fetch;
  let seen: number[];
  const listener = (_l: boolean, c: number) => { seen.push(c); };

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('autobacs_session_id', 'sess_test');
    jest.spyOn(console, 'log').mockImplementation(() => {});
    global.fetch = jest.fn(() => Promise.resolve(okResponse())) as unknown as typeof fetch;
    // Writes first seed the CSRF cookie; keep that out of the way.
    document.cookie = 'XSRF-TOKEN=test';
    seen = [];
    (apiClient as any).addLoadingListener(listener);
  });

  afterEach(() => {
    (apiClient as any).removeLoadingListener(listener);
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('a GET (e.g. the 20 s bell poll) does not notify the bar', async () => {
    await apiClient.get('/notifications/summary');
    expect(seen).toEqual([]);
  });

  it('a save the person pressed shows the bar, then clears it', async () => {
    await apiClient.post('/staff/tasks', { title: 'x' });
    expect(seen).toEqual([1, 0]);
  });

  it('a background write (read receipt, typing ping) does not notify the bar', async () => {
    await apiClient.post('/chat/channels/abc/read', { seq: 1 }, { background: true });
    expect(seen).toEqual([]);
  });

  it('the background flag is not forwarded to fetch', async () => {
    await apiClient.post('/chat/channels/abc/typing', {}, { background: true });
    const init = (global.fetch as jest.Mock).mock.calls.at(-1)[1];
    expect(init).not.toHaveProperty('background');
  });
});
