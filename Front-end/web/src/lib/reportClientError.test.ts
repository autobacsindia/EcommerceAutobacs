import { httpStatusOf, isStaffPath, reportClientError, resetClientErrorReporter, setReporterViewer } from './reportClientError';

/**
 * The storefront's error reporter. What matters: it never throws, never sends for
 * staff (pages or sessions), never sends the query string, and cannot flood.
 */

const fetchMock = jest.fn();

function setPath(path: string) {
  window.history.pushState({}, '', path);
}
const sentBodies = () => fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body));

beforeEach(() => {
  resetClientErrorReporter();
  fetchMock.mockReset().mockResolvedValue({ ok: true });
  (global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
  setPath('/careers');
});

describe('reportClientError', () => {
  test('sends feature, step, error details and the path WITHOUT the query string', () => {
    setPath('/checkout?token=secret&email=a@b.c');
    const err = new Error('Upload failed: HTTP 503');
    reportClientError({ feature: 'careers', step: 'file-upload', error: err, orderId: 'abc', context: { httpStatus: 503, slot: 'videoOne', empty: '', none: null } });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/client-errors');
    expect(init).toMatchObject({ method: 'POST', keepalive: true, credentials: 'same-origin' });
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      feature: 'careers', step: 'file-upload', level: 'error', name: 'Error',
      message: 'Upload failed: HTTP 503', orderId: 'abc', context: { httpStatus: 503, slot: 'videoOne' },
    });
    expect(body.url).toBe(`${window.location.origin}/checkout`);
    expect(init.body).not.toMatch(/secret|a@b\.c/);
    expect(body.stack).toContain('Error');
  });

  test('a message without an error, and non-Error throws, are described', () => {
    reportClientError({ feature: 'payment', step: 'dismissed', level: 'warning', message: 'closed' });
    reportClientError({ feature: 'script', step: 'unhandled-rejection', error: 'plain string' });
    reportClientError({ feature: 'script', step: 'unhandled-rejection', error: { name: 'TypeError', message: 'x is undefined' } });
    expect(sentBodies().map((b) => [b.name, b.message, b.level])).toEqual([
      ['Error', 'closed', 'warning'],
      ['Error', 'plain string', 'error'],
      ['TypeError', 'x is undefined', 'error'],
    ]);
  });

  test.each(['/admin/orders', '/team', '/team/marketing/coupons', '/staff-invite/abc', '/dev/x'])('skips the staff page %s', (path) => {
    setPath(path);
    reportClientError({ feature: 'script', error: new Error('x') });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test.each(['staff', 'admin'])('skips a signed-in %s on a customer page', (role) => {
    setReporterViewer(role);
    reportClientError({ feature: 'payment', error: new Error('x') });
    expect(fetchMock).not.toHaveBeenCalled();
    setReporterViewer('customer');
    reportClientError({ feature: 'payment', error: new Error('x') });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('noise and browser-extension errors are ignored', () => {
    reportClientError({ feature: 'script', message: 'Script error.' });
    reportClientError({ feature: 'script', message: 'ResizeObserver loop completed with undelivered notifications.' });
    const abort = new Error('aborted'); abort.name = 'AbortError';
    reportClientError({ feature: 'script', error: abort });
    const ext = new Error('boom'); ext.stack = 'Error: boom\n at x (chrome-extension://abc/content.js:1:1)';
    reportClientError({ feature: 'script', error: ext });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('the same error is sent once per 30 seconds, and at most 15 per page load', () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    try {
      for (let i = 0; i < 5; i += 1) reportClientError({ feature: 'script', message: 'same' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      now.mockReturnValue(1_000_000 + 31_000);
      reportClientError({ feature: 'script', message: 'same' });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      for (let i = 0; i < 40; i += 1) reportClientError({ feature: 'script', message: `different ${i}` });
      expect(fetchMock).toHaveBeenCalledTimes(15);
    } finally {
      now.mockRestore();
    }
  });

  test('never throws: a fetch that throws or rejects is swallowed', async () => {
    fetchMock.mockImplementationOnce(() => { throw new Error('sync boom'); });
    expect(() => reportClientError({ feature: 'script', message: 'a' })).not.toThrow();
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect(() => reportClientError({ feature: 'script', message: 'b' })).not.toThrow();
    await Promise.resolve();
    // An error whose getters throw is survived too.
    const evil = { get message() { throw new Error('getter'); } };
    expect(() => reportClientError({ feature: 'script', error: evil })).not.toThrow();
  });

  test('long fields are capped before sending', () => {
    const err = new Error('m'.repeat(5000)); err.stack = 's'.repeat(20000);
    reportClientError({ feature: 'script', error: err });
    const [body] = sentBodies();
    expect(body.message.length).toBe(500);
    expect(body.stack.length).toBe(4000);
  });
});

describe('helpers', () => {
  test('isStaffPath', () => {
    expect(isStaffPath('/admin')).toBe(true);
    expect(isStaffPath('/team/orders')).toBe(true);
    expect(isStaffPath('/teamwork')).toBe(false);
    expect(isStaffPath('/careers')).toBe(false);
  });

  test('httpStatusOf reads ApiError-style statuses', () => {
    expect(httpStatusOf({ status: 503 })).toBe(503);
    expect(httpStatusOf({ response: { status: 404 } })).toBe(404);
    expect(httpStatusOf(new Error('x'))).toBeUndefined();
    expect(httpStatusOf(null)).toBeUndefined();
  });
});
