import { safeLocal, safeSession } from '../safeStorage';
import { blockStorage } from '@/test-utils/blockStorage';

describe('safeStorage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it.each([
    ['local', safeLocal, () => window.localStorage],
    ['session', safeSession, () => window.sessionStorage],
  ] as const)('%s: reads, writes and removes like normal storage', (_n, s, real) => {
    expect(s.get('k')).toBeNull();
    expect(s.set('k', 'v')).toBe(true);
    expect(real().getItem('k')).toBe('v');
    expect(s.get('k')).toBe('v');
    s.remove('k');
    expect(real().getItem('k')).toBeNull();
  });

  it('JSON round-trip, with the fallback for missing or corrupt values', () => {
    expect(safeLocal.getJSON('j', ['fallback'])).toEqual(['fallback']);
    expect(safeLocal.setJSON('j', { a: 1 })).toBe(true);
    expect(safeLocal.getJSON('j', null)).toEqual({ a: 1 });
    window.localStorage.setItem('j', '{not json');
    expect(safeLocal.getJSON('j', 'fb')).toBe('fb');
  });

  it('a value JSON cannot serialise is not saved (no throw)', () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(safeLocal.setJSON('j', loop)).toBe(false);
  });

  describe('storage blocked (Instagram / Facebook in-app browser)', () => {
    let restore: () => void;
    beforeEach(() => { restore = blockStorage(); });
    afterEach(() => restore());

    it('the raw access really throws (proves the test setup)', () => {
      expect(() => window.localStorage.getItem('x')).toThrow();
      expect(() => window.sessionStorage.getItem('x')).toThrow();
    });

    it.each([['local', safeLocal], ['session', safeSession]] as const)('%s: never throws', (_n, s) => {
      expect(s.get('k')).toBeNull();
      expect(s.set('k', 'v')).toBe(false);
      expect(() => s.remove('k')).not.toThrow();
      expect(s.getJSON('k', [1])).toEqual([1]);
      expect(s.setJSON('k', { a: 1 })).toBe(false);
    });
  });

  it('storage full (QuotaExceededError on write) → false, no throw', () => {
    const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    expect(safeLocal.set('k', 'v')).toBe(false);
    spy.mockRestore();
  });
});
