/**
 * Regression tests for two security defects the existing suite was correctly
 * catching, and which had been failing long enough to be treated as noise.
 *
 *  1. `logout-all` cleared refresh tokens but never bumped `sessionVersion`, so
 *     every ALREADY-ISSUED access token stayed valid for its full lifetime —
 *     30 minutes for a customer, 15 for an admin. "Log out all devices" did not
 *     end an active session.
 *  2. Password validation was length-only, so `"password"` (8 chars) registered
 *     successfully.
 *
 * Both are asserted at the behavioural level (HTTP in, HTTP out) rather than by
 * poking internals, so a future refactor that reintroduces either is caught.
 */

import request from 'supertest';
import { app } from '../app.js';
import User from '../models/User.js';
import * as dbHandler from './db-handler.js';
import { API, accessTokenFrom } from './helpers/api.js';
import { isCommonPassword } from '../config/commonPasswords.js';

const AUTH = `${API}/auth`;
const CREDS = { name: 'Revoke Test', email: 'revoke@example.com', password: 'SecurePass123!' };

beforeAll(async () => { await dbHandler.connect(); });
afterAll(async () => { await dbHandler.closeDatabase(); });
afterEach(async () => { await dbHandler.clearDatabase(); });

async function registerAndLogin() {
  await request(app).post(`${AUTH}/register`).send(CREDS);
  const res = await request(app).post(`${AUTH}/login`)
    .send({ email: CREDS.email, password: CREDS.password });
  return accessTokenFrom(res);
}

describe('logout-all invalidates existing access tokens', () => {
  it('rejects an access token issued BEFORE logout-all', async () => {
    const token = await registerAndLogin();

    // Sanity: the token works to begin with, or the test proves nothing.
    const before = await request(app).get(`${AUTH}/me`).set('Authorization', `Bearer ${token}`);
    expect(before.statusCode).toBe(200);

    await request(app).post(`${AUTH}/logout-all`).set('Authorization', `Bearer ${token}`);

    const after = await request(app).get(`${AUTH}/me`).set('Authorization', `Bearer ${token}`);
    expect([401, 403]).toContain(after.statusCode);
  });

  it('invalidates tokens from OTHER sessions too, not just the caller', async () => {
    await request(app).post(`${AUTH}/register`).send(CREDS);
    const a = accessTokenFrom(await request(app).post(`${AUTH}/login`)
      .send({ email: CREDS.email, password: CREDS.password }));
    const b = accessTokenFrom(await request(app).post(`${AUTH}/login`)
      .send({ email: CREDS.email, password: CREDS.password }));

    await request(app).post(`${AUTH}/logout-all`).set('Authorization', `Bearer ${a}`);

    // The whole point of "all devices": the OTHER device dies too.
    const other = await request(app).get(`${AUTH}/me`).set('Authorization', `Bearer ${b}`);
    expect([401, 403]).toContain(other.statusCode);
  });

  it('increments sessionVersion — the mechanism protect relies on', async () => {
    const token = await registerAndLogin();
    const before = (await User.findOne({ email: CREDS.email })).sessionVersion || 0;

    await request(app).post(`${AUTH}/logout-all`).set('Authorization', `Bearer ${token}`);

    const after = (await User.findOne({ email: CREDS.email })).sessionVersion;
    expect(after).toBe(before + 1);
  });
});

describe('common-password blocklist', () => {
  it.each(['password', 'PASSWORD', 'Password ', '12345678', 'qwertyui', 'welcome1'])(
    'rejects %p at registration',
    async (password) => {
      const res = await request(app).post(`${AUTH}/register`)
        .send({ name: 'Weak User', email: `weak-${Date.now()}@example.com`, password });
      expect(res.statusCode).toBe(400);
    },
  );

  it('still accepts a strong password', async () => {
    const res = await request(app).post(`${AUTH}/register`)
      .send({ name: 'Strong User', email: 'strong@example.com', password: 'SecurePass123!' });
    expect(res.statusCode).toBe(201);
  });

  // NIST 800-63B favours long passphrases; composition rules would have rejected
  // this while accepting "Password1!". The blocklist must not get in their way.
  it('accepts a long passphrase with no digits or symbols', async () => {
    const res = await request(app).post(`${AUTH}/register`)
      .send({ name: 'Passphrase User', email: 'phrase@example.com', password: 'correct horse battery staple' });
    expect(res.statusCode).toBe(201);
  });

  describe('isCommonPassword', () => {
    it('is case-insensitive and trims', () => {
      expect(isCommonPassword('PaSsWoRd')).toBe(true);
      expect(isCommonPassword('  password  ')).toBe(true);
    });

    it('does not flag a strong password', () => {
      expect(isCommonPassword('SecurePass123!')).toBe(false);
    });

    it('handles non-string input without throwing', () => {
      expect(isCommonPassword(undefined)).toBe(false);
      expect(isCommonPassword(null)).toBe(false);
      expect(isCommonPassword(12345678)).toBe(false);
    });
  });
});
