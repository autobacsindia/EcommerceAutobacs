/**
 * Festival (Diwali) price offer — the pure maths, the switch, the admin API, the cache
 * purge, and the marketing feeds.
 *
 * The money path end to end (quote, order snapshot, sales panel untouched) lives in
 * tests/festivalOfferPricing.test.js.
 */

import { readFileSync } from 'node:fs';
import request from 'supertest';
import { jest } from '@jest/globals';
import bcrypt from 'bcryptjs';
import { app, cronService, adaptiveThrottlingService } from '../app.js';
import User from '../models/User.js';
import FestivalOffer from '../models/FestivalOffer.js';
import AuditLog from '../models/AuditLog.js';
import cacheService from '../services/cacheService.js';
import {
  applyFestivalOffer,
  tierPercentForPaise,
  FESTIVAL_OFFER_TIERS,
} from '../utils/festivalOffer.js';
import {
  isFestivalOfferLive,
  toPublicOffer,
  isOfferLiveForPricing,
  FESTIVAL_OFFER_CACHE_TAG,
} from '../services/festivalOfferService.js';
import { festivalOfferTags } from '../utils/nextTags.js';
import { pathsForPatterns } from '../config/cdnPurgeUrls.js';
import { priceFields } from '../utils/feedFormat.js';
import { buildGoogleMerchantFeed } from '../services/googleFeedService.js';
import { buildMetaCatalogFeed } from '../services/metaFeedService.js';
import * as dbHandler from './db-handler.js';

const { cases: CASES } = JSON.parse(
  readFileSync(new URL('./fixtures/festivalOfferCases.json', import.meta.url), 'utf8'),
);

const BASE = '/api/v1';
const HOUR = 60 * 60 * 1000;
const NOW = new Date('2026-11-06T12:00:00Z');
const at = (ms) => new Date(NOW.getTime() + ms);

function extractCsrfFromSetCookie(setCookieHeader = []) {
  const xsrf = setCookieHeader.find((c) => c.startsWith('XSRF-TOKEN='));
  return xsrf ? xsrf.split(';')[0].split('=')[1] : '';
}

// ── Pure maths ───────────────────────────────────────────────────────────────
describe('applyFestivalOffer — shared case table (same table the storefront runs)', () => {
  it.each(CASES.map((c) => [c.name, c]))('%s', (_name, c) => {
    const out = applyFestivalOffer({ unitPrice: c.unitPrice, listPrice: c.listPrice });
    if (c.expected === null) {
      expect(out).toBeNull();
    } else {
      expect(out).toEqual({ code: 'diwali', ...c.expected });
    }
  });

  it('the final price is always whole rupees and never above the pre-offer price', () => {
    for (let rupees = 1; rupees < 200000; rupees += 997.37) {
      const out = applyFestivalOffer({ unitPrice: rupees });
      if (!out) continue;
      expect(Number.isInteger(out.finalPrice)).toBe(true);
      expect(out.finalPrice).toBeLessThan(rupees);
      // Never more than the advertised % (rounding only ever favours the buyer).
      expect(out.finalPrice).toBeLessThanOrEqual(rupees * (100 - out.percent) / 100);
    }
  });

  it('tier boundaries are exact in paise', () => {
    expect(tierPercentForPaise(49_999_99)).toBe(10);
    expect(tierPercentForPaise(50_000_00)).toBe(5);
    expect(tierPercentForPaise(1_00_000_00)).toBe(5);
    expect(tierPercentForPaise(1_00_000_01)).toBe(3);
    expect(tierPercentForPaise(2_00_000_00)).toBe(3);
    expect(tierPercentForPaise(2_00_000_01)).toBe(2);
    expect(tierPercentForPaise(0)).toBe(0);
    expect(tierPercentForPaise(NaN)).toBe(0);
  });

  it('the tier ladder is frozen — no caller can mutate the money rules at runtime', () => {
    expect(Object.isFrozen(FESTIVAL_OFFER_TIERS)).toBe(true);
    expect(Object.isFrozen(FESTIVAL_OFFER_TIERS[0])).toBe(true);
  });
});

// ── Switch / window ──────────────────────────────────────────────────────────
describe('isFestivalOfferLive', () => {
  it('is off when disabled, whatever the dates', () => {
    expect(isFestivalOfferLive({ enabled: false, startsAt: at(-HOUR), endsAt: at(HOUR) }, NOW)).toBe(false);
  });
  it('is on when enabled with an open window', () => {
    expect(isFestivalOfferLive({ enabled: true }, NOW)).toBe(true);
  });
  it('is off before the start and on exactly at the start', () => {
    expect(isFestivalOfferLive({ enabled: true, startsAt: at(1) }, NOW)).toBe(false);
    expect(isFestivalOfferLive({ enabled: true, startsAt: NOW }, NOW)).toBe(true);
  });
  it('is off exactly at the end (end is exclusive) and after it', () => {
    expect(isFestivalOfferLive({ enabled: true, endsAt: NOW }, NOW)).toBe(false);
    expect(isFestivalOfferLive({ enabled: true, endsAt: at(-1) }, NOW)).toBe(false);
    expect(isFestivalOfferLive({ enabled: true, endsAt: at(1) }, NOW)).toBe(true);
  });
  it('treats null/undefined config (never saved) as off', () => {
    expect(isFestivalOfferLive(null, NOW)).toBe(false);
    expect(isFestivalOfferLive(undefined, NOW)).toBe(false);
  });
});

describe('toPublicOffer', () => {
  it('is null when off or already ended', () => {
    expect(toPublicOffer({ enabled: false }, NOW)).toBeNull();
    expect(toPublicOffer({ enabled: true, endsAt: at(-1) }, NOW)).toBeNull();
  });
  it('returns a not-yet-started offer with live:false so a cached page can switch on', () => {
    expect(toPublicOffer({ enabled: true, startsAt: at(HOUR) }, NOW).live).toBe(false);
  });
  it('carries the tier ladder so the storefront never hard-codes its own', () => {
    const out = toPublicOffer({ enabled: true, updatedBy: 'x', _id: 'y' }, NOW);
    expect(Object.keys(out).sort()).toEqual(['code', 'endsAt', 'live', 'startsAt', 'tiers']);
    expect(out.tiers).toEqual(FESTIVAL_OFFER_TIERS.map((t) => ({ ...t })));
  });
});

describe('festival offer cache wiring', () => {
  it('uses a frontend tag the revalidator allowlist forwards', () => {
    expect(festivalOfferTags()).toEqual(['promo:festival-offer']);
  });
  it('purges the exact public URL at the edge', () => {
    expect(pathsForPatterns([FESTIVAL_OFFER_CACHE_TAG])).toEqual(['/festival-offer/active']);
  });
});

// ── Feeds ────────────────────────────────────────────────────────────────────
describe('marketing feeds advertise the price the checkout charges', () => {
  const WINDOW = { startsAt: new Date('2026-11-01T00:00:00Z'), endsAt: new Date('2026-11-10T00:00:00Z') };

  it('offer off → feed price fields are exactly as before', () => {
    expect(priceFields({ price: 40000 })).toEqual({
      price: '40000.00 INR', salePrice: null, salePriceEffectiveDate: null, effectiveRupees: 40000,
    });
    expect(priceFields({ price: 48000, originalPrice: 60000 })).toMatchObject({
      price: '60000.00 INR', salePrice: '48000.00 INR',
    });
  });

  it('offer on, no MRP → price as price, Diwali price as sale_price, bounded by the window', () => {
    expect(priceFields({ price: 40000 }, WINDOW)).toEqual({
      price: '40000.00 INR',
      salePrice: '36000.00 INR',
      salePriceEffectiveDate: '2026-11-01T00:00:00.000Z/2026-11-10T00:00:00.000Z',
      effectiveRupees: 36000,
    });
  });

  it('offer on with an existing sale → MRP as price, Diwali stacked on the sale price', () => {
    expect(priceFields({ price: 112500, originalPrice: 140625 }, WINDOW)).toMatchObject({
      price: '140625.00 INR', salePrice: '109125.00 INR', effectiveRupees: 109125,
      salePriceEffectiveDate: '2026-11-01T00:00:00.000Z/2026-11-10T00:00:00.000Z',
    });
  });

  it('serialises sale_price_effective_date in both feeds, only while the offer is on', () => {
    const product = {
      _id: '64b000000000000000000001', name: 'Roof Rack', slug: 'roof-rack', price: 40000,
      productType: 'simple', stock: 'in', images: [{ url: 'https://x/img.jpg' }], description: 'd',
    };
    const on = { festivalOffer: WINDOW, siteUrl: 'https://s' };
    for (const build of [buildGoogleMerchantFeed, buildMetaCatalogFeed]) {
      const offXml = build([product], { siteUrl: 'https://s' });
      expect(offXml).toContain('<g:price>40000.00 INR</g:price>');
      expect(offXml).not.toContain('sale_price');
      const onXml = build([product], on);
      expect(onXml).toContain('<g:sale_price>36000.00 INR</g:sale_price>');
      expect(onXml).toContain('<g:sale_price_effective_date>2026-11-01T00:00:00.000Z/2026-11-10T00:00:00.000Z</g:sale_price_effective_date>');
    }
  });
});

// ── HTTP ─────────────────────────────────────────────────────────────────────
describe('Festival offer API', () => {
  let agent;
  let csrfToken;
  const password = 'SecurePass123!';

  beforeAll(async () => { await dbHandler.connect(); });
  afterEach(async () => {
    await dbHandler.clearDatabase();
    await cacheService.invalidatePattern(FESTIVAL_OFFER_CACHE_TAG);
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
    ({ a: agent, csrf: csrfToken } = await login('offeradmin@example.com', 'admin'));
  });

  const put = (body, as = { a: agent, csrf: csrfToken }) =>
    as.a.put(`${BASE}/festival-offer/admin`).set('X-XSRF-TOKEN', as.csrf).send(body);
  const getActive = () => request(app).get(`${BASE}/festival-offer/active`);

  it('is off by default — no document, null offer, pricing sees off', async () => {
    const res = await getActive();
    expect(res.status).toBe(200);
    expect(res.body.offer).toBeNull();
    expect(await isOfferLiveForPricing()).toBe(false);
    // The pricing read never creates the singleton.
    expect(await FestivalOffer.countDocuments()).toBe(0);
  });

  it('turns on with a window, is served live with the tiers, and is audited', async () => {
    const res = await put({ enabled: true, startsAt: new Date(Date.now() - HOUR).toISOString(), endsAt: new Date(Date.now() + HOUR).toISOString() });
    expect(res.status).toBe(200);
    expect(res.body.offer).toMatchObject({ enabled: true, live: true });

    const pub = await getActive();
    expect(pub.body.offer).toMatchObject({ code: 'diwali', live: true });
    expect(pub.body.offer.tiers).toHaveLength(4);
    expect(await isOfferLiveForPricing()).toBe(true);

    const audit = await AuditLog.findOne({ action: 'FESTIVAL_OFFER_UPDATE' }).lean();
    expect(audit).toBeTruthy();
  });

  it('switches itself off after the end date with no admin action', async () => {
    await FestivalOffer.create({ key: 'default', enabled: true, endsAt: new Date(Date.now() - 1000) });
    expect((await getActive()).body.offer).toBeNull();
    expect(await isOfferLiveForPricing()).toBe(false);
  });

  it('switching off purges the cache — the next read is off, not the cached "on"', async () => {
    await put({ enabled: true });
    expect((await getActive()).body.offer).not.toBeNull();
    await put({ enabled: false });
    // invalidateCache is fire-and-forget; give the purge a tick to land.
    await new Promise((r) => setTimeout(r, 50));
    expect((await getActive()).body.offer).toBeNull();
    // Pricing never depended on the purge: it reads Mongo directly.
    expect(await isOfferLiveForPricing()).toBe(false);
  });

  it('rejects an end before the start and a bad date', async () => {
    const res = await put({ enabled: true, startsAt: '2026-11-10T00:00:00Z', endsAt: '2026-11-09T00:00:00Z' });
    expect(res.status).toBe(400);
    expect((await put({ enabled: true, endsAt: 'tomorrow' })).status).toBe(400);
    expect(await isOfferLiveForPricing()).toBe(false);
  });

  it('refuses customers and anonymous callers (never a 200)', async () => {
    const customer = await login('offercust@example.com', 'customer');
    expect((await put({ enabled: true }, customer)).status).toBe(403);
    const anon = await request(app).get(`${BASE}/festival-offer/admin`);
    expect(anon.status).toBe(401);
    expect(await isOfferLiveForPricing()).toBe(false);
  });

  it('lets the admin read the current settings uncached (off when never saved)', async () => {
    const res = await agent.get(`${BASE}/festival-offer/admin`);
    expect(res.status).toBe(200);
    expect(res.body.offer).toMatchObject({ enabled: false, live: false });
  });
});
