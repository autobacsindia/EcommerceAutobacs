import {
  readAuthCache,
  writeAuthCache,
  clearAuthCache,
  hasAuthenticatedSession,
} from './authStorage';

const KEY = 'auth_check';

describe('authStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('reports no session when nothing is cached', () => {
    expect(hasAuthenticatedSession()).toBe(false);
    expect(readAuthCache()).toBeNull();
  });

  it('a logged-out check writes a negative cache that is NOT a session', () => {
    // This is the exact entry AuthContext writes for a guest. The regression:
    // it exists under the key, but must not be mistaken for a live session.
    writeAuthCache(null, 0);

    expect(localStorage.getItem(KEY)).not.toBeNull(); // key is present…
    expect(hasAuthenticatedSession()).toBe(false); // …but there is no session.
  });

  it('reports a session only when a user is cached', () => {
    writeAuthCache({ _id: 'u1', role: 'customer' }, 3);

    expect(hasAuthenticatedSession()).toBe(true);
    expect(readAuthCache<{ _id: string }>()?.user?._id).toBe('u1');
  });

  it('treats a malformed entry as no session (no throw)', () => {
    localStorage.setItem(KEY, 'not-json{');

    expect(() => hasAuthenticatedSession()).not.toThrow();
    expect(hasAuthenticatedSession()).toBe(false);
    expect(readAuthCache()).toBeNull();
  });

  it('does not treat a JSON primitive (e.g. "null") as a session', () => {
    localStorage.setItem(KEY, 'null');
    expect(hasAuthenticatedSession()).toBe(false);

    localStorage.setItem(KEY, '42');
    expect(hasAuthenticatedSession()).toBe(false);
  });

  it('clearAuthCache removes the entry', () => {
    writeAuthCache({ _id: 'u1' }, 1);
    clearAuthCache();

    expect(hasAuthenticatedSession()).toBe(false);
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});
