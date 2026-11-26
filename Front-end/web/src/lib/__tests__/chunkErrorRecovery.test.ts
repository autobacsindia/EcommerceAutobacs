import { AUTO_RELOAD_WINDOW_MS, isChunkLoadError, shouldAutoReload } from '../chunkErrorRecovery';

describe('isChunkLoadError', () => {
  it.each([
    [Object.assign(new Error('x'), { name: 'ChunkLoadError' })],
    [new Error('Loading chunk 23330 failed.\n(error: https://www.autobacsindia.com/_next/static/chunks/23330.js)')],
    [new Error('Loading CSS chunk 1234 failed.')],
    [new TypeError('Failed to fetch dynamically imported module: https://x/y.js')],
    [new TypeError('Importing a module script failed.')],
  ])('recognises %p', (err) => {
    expect(isChunkLoadError(err)).toBe(true);
  });

  it.each([[new Error('Cannot read properties of undefined')], [null], ['Loading chunk 1 failed'], [{}]])(
    'does not treat %p as a chunk failure',
    (err) => {
      expect(isChunkLoadError(err)).toBe(false);
    },
  );
});

describe('shouldAutoReload', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('allows one reload, then refuses a second within the window (no reload loop)', () => {
    expect(shouldAutoReload(1_000_000)).toBe(true);
    expect(shouldAutoReload(1_000_000 + 5_000)).toBe(false);
  });

  it('allows another reload once the window has passed', () => {
    expect(shouldAutoReload(1_000_000)).toBe(true);
    expect(shouldAutoReload(1_000_000 + AUTO_RELOAD_WINDOW_MS + 1)).toBe(true);
  });

  it('never auto-reloads when storage is unavailable (cannot prove it is not looping)', () => {
    const spy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(shouldAutoReload()).toBe(false);
    spy.mockRestore();
  });
});
