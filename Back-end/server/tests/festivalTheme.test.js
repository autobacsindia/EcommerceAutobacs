/**
 * Festival theme switch — date window, public shape, admin auth, and the cache
 * purge that makes "off" mean off straight away.
 */

import request from 'supertest';
import { jest } from '@jest/globals';
import bcrypt from 'bcryptjs';
import { app, cronService, adaptiveThrottlingService } from '../app.js';
import User from '../models/User.js';
import FestivalTheme from '../models/FestivalTheme.js';
import cacheService from '../services/cacheService.js';
import {
  isFestivalThemeLive,
  toPublicTheme,
  FESTIVAL_THEME_CACHE_TAG,
} from '../services/festivalThemeService.js';
import { festivalThemeTags } from '../utils/nextTags.js';
import { pathsForPatterns } from '../config/cdnPurgeUrls.js';
import * as dbHandler from './db-handler.js';

const BASE = '/api/v1';
const HOUR = 60 * 60 * 1000;
const NOW = new Date('2026-11-06T12:00:00Z');
const at = (ms) => new Date(NOW.getTime() + ms);

function extractCsrfFromSetCookie(setCookieHeader = []) {
  const xsrf = setCookieHeader.find((c) => c.startsWith('XSRF-TOKEN='));
  return xsrf ? xsrf.split(';')[0].split('=')[1] : '';
}

// ── Pure window logic ────────────────────────────────────────────────────────
describe('isFestivalThemeLive', () => {
  it('is off when disabled, whatever the dates', () => {
    expect(isFestivalThemeLive({ enabled: false }, NOW)).toBe(false);
    expect(isFestivalThemeLive({ enabled: false, startsAt: at(-HOUR), endsAt: at(HOUR) }, NOW)).toBe(false);
  });
  it('is on when enabled with an open window', () => {
    expect(isFestivalThemeLive({ enabled: true }, NOW)).toBe(true);
  });
  it('is off before the start and on exactly at the start', () => {
    expect(isFestivalThemeLive({ enabled: true, startsAt: at(1) }, NOW)).toBe(false);
    expect(isFestivalThemeLive({ enabled: true, startsAt: NOW }, NOW)).toBe(true);
  });
  it('is off exactly at the end (end is exclusive) and after it', () => {
    expect(isFestivalThemeLive({ enabled: true, endsAt: at(1) }, NOW)).toBe(true);
    expect(isFestivalThemeLive({ enabled: true, endsAt: NOW }, NOW)).toBe(false);
    expect(isFestivalThemeLive({ enabled: true, endsAt: at(-HOUR) }, NOW)).toBe(false);
  });
  it('treats null/undefined config as off', () => {
    expect(isFestivalThemeLive(null, NOW)).toBe(false);
    expect(isFestivalThemeLive(undefined, NOW)).toBe(false);
  });
});

describe('toPublicTheme', () => {
  it('is null when off or already ended', () => {
    expect(toPublicTheme({ enabled: false, themeKey: 'diwali' }, NOW)).toBeNull();
    expect(toPublicTheme({ enabled: true, themeKey: 'diwali', endsAt: at(-1) }, NOW)).toBeNull();
  });
  it('returns a not-yet-started theme with live:false so a cached page can switch on at the start', () => {
    expect(toPublicTheme({ enabled: true, themeKey: 'diwali', startsAt: at(HOUR), endsAt: at(2 * HOUR) }, NOW))
      .toEqual({ themeKey: 'diwali', startsAt: at(HOUR).toISOString(), endsAt: at(2 * HOUR).toISOString(), live: false });
  });
  it('exposes only the four public fields', () => {
    const out = toPublicTheme({ enabled: true, themeKey: 'diwali', updatedBy: 'x', _id: 'y' }, NOW);
    expect(Object.keys(out).sort()).toEqual(['endsAt', 'live', 'startsAt', 'themeKey']);
  });
});

describe('festival theme cache wiring', () => {
  it('uses a frontend tag the revalidator allowlist forwards', () => {
    expect(festivalThemeTags()).toEqual(['promo:festival-theme']);
  });
  it('purges the exact public URL at the edge', () => {
    expect(pathsForPatterns([FESTIVAL_THEME_CACHE_TAG])).toEqual(['/festival-theme/active']);
  });
});

// ── HTTP ─────────────────────────────────────────────────────────────────────
describe('Festival theme API', () => {
  let agent;
  let csrfToken;
  const password = 'SecurePass123!';

  beforeAll(async () => { await dbHandler.connect(); });
  afterEach(async () => {
    await dbHandler.clearDatabase();
    await cacheService.invalidatePattern(FESTIVAL_THEME_CACHE_TAG);
    jest.restoreAllMocks();
  });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });

  const login = async (email, role, extra = {}) => {
    const passwordHash = await bcrypt.hash(password, await bcrypt.genSalt(10));
    await User.create({ name: `T ${role}`, email, passwordHash, role, ...extra });
    const a = request.agent(app);
    const res = await a.post(`${BASE}/auth/login`).send({ email, password });
    return { a, csrf: extractCsrfFromSetCookie(res.headers['set-cookie']) };
  };

  beforeEach(async () => {
    ({ a: agent, csrf: csrfToken } = await login('festadmin@example.com', 'admin'));
  });

  const put = (body, as = { a: agent, csrf: csrfToken }) =>
    as.a.put(`${BASE}/festival-theme/admin`).set('X-XSRF-TOKEN', as.csrf).send(body);
  const getActive = () => request(app).get(`${BASE}/festival-theme/active`);

  it('is null by default (off all year)', async () => {
    const res = await getActive();
    expect(res.status).toBe(200);
    expect(res.body.theme).toBeNull();
  });

  it('turns on with a window and is served live', async () => {
    const startsAt = new Date(Date.now() - HOUR).toISOString();
    const endsAt = new Date(Date.now() + HOUR).toISOString();
    const save = await put({ enabled: true, themeKey: 'diwali', startsAt, endsAt });
    expect(save.status).toBe(200);
    expect(save.body.theme).toMatchObject({ enabled: true, live: true, startsAt, endsAt });

    const res = await getActive();
    expect(res.body.theme).toEqual({ themeKey: 'diwali', startsAt, endsAt, live: true });
  });

  it('hides itself after the end date with no admin action', async () => {
    await FestivalTheme.create({ key: 'default', enabled: true, endsAt: new Date(Date.now() - 1000) });
    expect((await getActive()).body.theme).toBeNull();
  });

  it('switching off purges the cache — the next read is off, not the cached "on"', async () => {
    await put({ enabled: true });
    expect((await getActive()).body.theme).not.toBeNull(); // warm the cache

    await put({ enabled: false });
    // invalidateCache is fire-and-forget; let its promise settle.
    await new Promise((r) => setTimeout(r, 50));
    expect((await getActive()).body.theme).toBeNull();
  });

  it('caches the quiet "off" case instead of reading Mongo every request', async () => {
    await getActive();
    const spy = jest.spyOn(FestivalTheme, 'findOne');
    await getActive();
    expect(spy).not.toHaveBeenCalled();
  });

  it('rejects an end before the start', async () => {
    const res = await put({
      enabled: true,
      startsAt: new Date(Date.now() + 2 * HOUR).toISOString(),
      endsAt: new Date(Date.now() + HOUR).toISOString(),
    });
    expect(res.status).toBe(400);
    expect(await FestivalTheme.countDocuments({ enabled: true })).toBe(0);
  });

  it('rejects an unknown theme key and a bad date', async () => {
    expect((await put({ enabled: true, themeKey: 'halloween' })).status).toBe(400);
    expect((await put({ enabled: true, startsAt: 'not-a-date' })).status).toBe(400);
    expect((await put({ startsAt: null })).status).toBe(400); // enabled is required
  });

  it('clears a date when sent null', async () => {
    await put({ enabled: true, endsAt: new Date(Date.now() + HOUR).toISOString() });
    const res = await put({ enabled: true, endsAt: null });
    expect(res.body.theme.endsAt).toBeNull();
  });

  it('refuses customers and anonymous callers (never a 200)', async () => {
    const shopper = await login('festshopper@example.com', 'customer');
    expect((await put({ enabled: true }, shopper)).status).toBe(403);
    expect((await shopper.a.get(`${BASE}/festival-theme/admin`)).status).toBe(403);
    const anon = await request(app).get(`${BASE}/festival-theme/admin`);
    expect(anon.status).toBe(401);
    expect(await FestivalTheme.countDocuments({ enabled: true })).toBe(0);
  });

  it('lets the admin read the current settings uncached', async () => {
    await put({ enabled: true });
    const res = await agent.get(`${BASE}/festival-theme/admin`);
    expect(res.status).toBe(200);
    expect(res.body.theme).toMatchObject({ enabled: true, themeKey: 'diwali', live: true });
  });
});
