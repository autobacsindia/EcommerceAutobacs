/**
 * Campaign HTTP surface — route wiring, auth boundaries, and the landing-page contract.
 *
 * The security-relevant cases here are the admin boundaries (a campaign's tiers and
 * kill switch must never be reachable by a signed-in shopper) and the shape of
 * check-email, which is what routes 187 password-less customers to the right door.
 */

import { jest } from '@jest/globals';
import request from 'supertest';
import mongoose from 'mongoose';
import { app } from '../app.js';
import User from '../models/User.js';
import Campaign from '../models/Campaign.js';
import CampaignMember from '../models/CampaignMember.js';
import { CAMPAIGN_STATUS, CAMPAIGN_AUDIENCE } from '../config/campaign.js';
import { generateTokenPair } from '../utils/sessionManager.js';

jest.setTimeout(60000);

const SLUG = 'route-test-campaign';
let seq = 0;

const seedUser = async ({ role = 'customer', isVerified = true, mustResetPassword = false, email } = {}) =>
  User.create({
    name: 'U', email: email || `route${++seq}${Date.now()}@x.com`,
    passwordHash: 'x', role, isVerified, mustResetPassword,
  });

// The real client authenticates by httpOnly cookie, but cookie auth is CSRF-guarded and
// these tests hold no CSRF token. Same workaround as ordersIntegration/cart tests: send
// the access token as a (CSRF-exempt) Bearer. Auth and role checks are identical on both
// paths — only the CSRF middleware differs — so the admin boundaries are still genuinely
// under test rather than passing because CSRF happened to reject the request.
const auth = (user) => {
  const { accessToken } = generateTokenPair(user, '127.0.0.1', 'jest');
  return `Bearer ${accessToken}`;
};

/**
 * check-email is an unauthenticated POST, so it carries no Bearer and is fully
 * CSRF-protected. Rather than exempt it, these tests do exactly what the browser does:
 * seed a token from /csrf-token, then send it as both cookie and header. That keeps the
 * public endpoint's CSRF protection genuinely under test.
 */
let csrfPair, csrfToken;

beforeAll(async () => {
  const seed = await request(app).get('/api/v1/csrf-token');
  csrfPair = (seed.headers['set-cookie'] || []).find(c => c.startsWith('XSRF-TOKEN=')).split(';')[0];
  csrfToken = csrfPair.split('=')[1];
});

// Seeded once above so this stays synchronous and supertest's .expect() chain works.
const csrfPost = (url, body) =>
  request(app).post(url).set('Cookie', csrfPair).set('x-xsrf-token', csrfToken).send(body);

async function seedCampaign(overrides = {}) {
  return Campaign.create({
    slug: SLUG,
    name: 'Route Test',
    status: CAMPAIGN_STATUS.LIVE,
    audience: CAMPAIGN_AUDIENCE.LIST,
    endsAt: new Date(Date.now() + 7 * 864e5),
    couponCode: 'ROUTETEST',
    maxRedemptions: 100,
    maxDiscountPerOrder: 50000,
    tiers: [
      { id: 'festive20', label: 'Festive 20', minCartValue: 0, percent: 20, maxDiscount: 20000 },
      { id: 'grand10', label: 'Grand 10', minCartValue: 100000, percent: 10, maxDiscount: null },
    ],
    ...overrides,
  });
}

afterEach(async () => {
  await Promise.all([
    Campaign.deleteMany({}), CampaignMember.deleteMany({}), User.deleteMany({}),
  ]);
});

describe('GET /campaigns/:slug/me', () => {
  it('tells a logged-out visitor which email to sign in with', async () => {
    await seedCampaign();
    const res = await request(app).get(`/api/v1/campaigns/${SLUG}/me`).expect(200);

    expect(res.body.campaign.eligible).toBe(false);
    expect(res.body.campaign.reason).toMatch(/log in with the email/i);
    // The ladder is safe to publish — it is what the printed card advertises, and the
    // cart meter needs it to show "add X more to save Y more".
    expect(res.body.campaign.tiers).toHaveLength(2);
    expect(res.body.campaign.couponCode).toBeNull();
  });

  it('returns the tier and the code for an invited, verified customer', async () => {
    const campaign = await seedCampaign();
    const user = await seedUser({ email: 'invited@x.com' });
    await CampaignMember.create({ campaign: campaign._id, email: 'invited@x.com' });

    const res = await request(app)
      .get(`/api/v1/campaigns/${SLUG}/me?cartValue=50000`)
      .set('Authorization', auth(user))
      .expect(200);

    expect(res.body.campaign.eligible).toBe(true);
    expect(res.body.campaign.couponCode).toBe('ROUTETEST');
    expect(res.body.campaign.tier).toMatchObject({ tierId: 'festive20', percent: 20 });
  });

  it('claims the invite so the funnel populates without the frontend reporting it', async () => {
    const campaign = await seedCampaign();
    const user = await seedUser({ email: 'claims@x.com' });
    await CampaignMember.create({ campaign: campaign._id, email: 'claims@x.com' });

    await request(app)
      .get(`/api/v1/campaigns/${SLUG}/me?cartValue=50000`)
      .set('Authorization', auth(user))
      .expect(200);

    const member = await CampaignMember.findOne({ campaign: campaign._id, email: 'claims@x.com' });
    expect(member.status).toBe('claimed');
    expect(String(member.user)).toBe(String(user._id));
  });

  it('is never cached by a shared cache', async () => {
    // Per-user eligibility behind a shared cache key would hand one buyer's discount
    // to every visitor.
    await seedCampaign();
    const res = await request(app).get(`/api/v1/campaigns/${SLUG}/me`).expect(200);
    expect(res.headers['cache-control']).toMatch(/no-store/);
    expect(res.headers['cache-control']).toMatch(/private/);
  });

  it('404s for an unknown campaign', async () => {
    await request(app).get('/api/v1/campaigns/no-such-campaign/me').expect(404);
  });
});

describe('POST /campaigns/:slug/check-email', () => {
  it('routes an imported customer to "set a password"', async () => {
    // The majority case: account exists, email confirmed by the import, but no password
    // was ever set. Telling this person to "log in" would strand them.
    const campaign = await seedCampaign();
    await seedUser({ email: 'imported@x.com', isVerified: true, mustResetPassword: true });
    await CampaignMember.create({ campaign: campaign._id, email: 'imported@x.com', name: 'Imported Person' });

    const res = await csrfPost(`/api/v1/campaigns/${SLUG}/check-email`, { email: 'imported@x.com' }).expect(200);

    expect(res.body).toMatchObject({ onList: true, action: 'set_password', name: 'Imported Person' });
  });

  it('routes an invited customer with no account to "register"', async () => {
    const campaign = await seedCampaign();
    await CampaignMember.create({ campaign: campaign._id, email: 'noaccount@x.com' });

    const res = await csrfPost(`/api/v1/campaigns/${SLUG}/check-email`, { email: 'noaccount@x.com' }).expect(200);

    expect(res.body).toMatchObject({ onList: true, action: 'register' });
  });

  it('routes a ready account to "login"', async () => {
    const campaign = await seedCampaign();
    await seedUser({ email: 'ready@x.com', isVerified: true, mustResetPassword: false });
    await CampaignMember.create({ campaign: campaign._id, email: 'ready@x.com' });

    const res = await csrfPost(`/api/v1/campaigns/${SLUG}/check-email`, { email: 'ready@x.com' }).expect(200);

    expect(res.body).toMatchObject({ onList: true, action: 'login' });
  });

  it('tells an uninvited address it is not on the list, and nothing else', async () => {
    await seedCampaign();
    await seedUser({ email: 'stranger@x.com' });

    const res = await csrfPost(`/api/v1/campaigns/${SLUG}/check-email`, { email: 'stranger@x.com' }).expect(200);

    expect(res.body).toMatchObject({ onList: false, action: 'not_invited' });
    // Must not leak whether an account exists for a non-invited address.
    expect(res.body.name).toBeUndefined();
  });

  it('matches regardless of the case the customer types', async () => {
    const campaign = await seedCampaign();
    await CampaignMember.create({ campaign: campaign._id, email: 'case@x.com' });

    const res = await csrfPost(`/api/v1/campaigns/${SLUG}/check-email`, { email: '  CASE@X.com  ' }).expect(200);

    expect(res.body.onList).toBe(true);
  });

  it('rejects a malformed email', async () => {
    await seedCampaign();
    await csrfPost(`/api/v1/campaigns/${SLUG}/check-email`, { email: 'not-an-email' }).expect(400);
  });
});

describe('admin boundaries', () => {
  const adminOnly = [
    ['get', `/api/v1/campaigns`],
    ['post', `/api/v1/campaigns`],
    ['get', `/api/v1/campaigns/${SLUG}/admin`],
    ['get', `/api/v1/campaigns/${SLUG}/report`],
  ];

  it.each(adminOnly)('%s %s rejects an anonymous visitor', async (method, url) => {
    const res = await request(app)[method](url).send({});
    expect([401, 403]).toContain(res.status);
  });

  it.each(adminOnly)('%s %s rejects a signed-in shopper', async (method, url) => {
    const shopper = await seedUser({ role: 'customer' });
    const res = await request(app)[method](url).set('Authorization', auth(shopper)).send({});
    expect([401, 403]).toContain(res.status);
  });

  it('rejects a shopper trying to flip the kill switch', async () => {
    const campaign = await seedCampaign();
    const shopper = await seedUser({ role: 'customer' });
    const res = await request(app)
      .patch(`/api/v1/campaigns/${campaign._id}/status`)
      .set('Authorization', auth(shopper))
      .send({ status: CAMPAIGN_STATUS.OFF });
    expect([401, 403]).toContain(res.status);
    expect((await Campaign.findById(campaign._id)).status).toBe(CAMPAIGN_STATUS.LIVE);
  });

  it('rejects a shopper trying to edit the tier ladder', async () => {
    const campaign = await seedCampaign();
    const shopper = await seedUser({ role: 'customer' });
    const res = await request(app)
      .put(`/api/v1/campaigns/${campaign._id}`)
      .set('Authorization', auth(shopper))
      .send({ tiers: [{ id: 'greed', minCartValue: 0, percent: 90 }] });
    expect([401, 403]).toContain(res.status);
    expect((await Campaign.findById(campaign._id)).tiers[0].percent).toBe(20);
  });
});

describe('admin operations', () => {
  let adminUser;
  beforeEach(async () => { adminUser = await seedUser({ role: 'admin' }); });

  it('flips the kill switch', async () => {
    const campaign = await seedCampaign();
    await request(app)
      .patch(`/api/v1/campaigns/${campaign._id}/status`)
      .set('Authorization', auth(adminUser))
      .send({ status: CAMPAIGN_STATUS.OFF })
      .expect(200);

    expect((await Campaign.findById(campaign._id)).status).toBe(CAMPAIGN_STATUS.OFF);
  });

  it('refuses a tier ladder with a discount cliff', async () => {
    const campaign = await seedCampaign();
    const res = await request(app)
      .put(`/api/v1/campaigns/${campaign._id}`)
      .set('Authorization', auth(adminUser))
      .send({
        resolution: 'window',
        tiers: [
          { id: 'a', minCartValue: 0, maxCartValue: 100000, percent: 20 },
          { id: 'b', minCartValue: 100000, maxCartValue: null, percent: 10 },
        ],
      })
      .expect(400);

    expect(res.body.message).toMatch(/REDUCE a customer's discount/i);
    expect((await Campaign.findById(campaign._id)).tiers[0].percent).toBe(20);
  });

  it('runs the cart calculator', async () => {
    const campaign = await seedCampaign();
    const res = await request(app)
      .post(`/api/v1/campaigns/${campaign._id}/simulate`)
      .set('Authorization', auth(adminUser))
      .send({ cartValues: [50000, 150000, 300000] })
      .expect(200);

    expect(res.body.results).toEqual([
      expect.objectContaining({ cartRupees: 50000, discountRupees: 10000, tierId: 'festive20' }),
      expect.objectContaining({ cartRupees: 150000, discountRupees: 20000, tierId: 'festive20' }),
      expect.objectContaining({ cartRupees: 300000, discountRupees: 30000, tierId: 'grand10' }),
    ]);
  });

  it('imports an allowlist and reports rejected rows', async () => {
    const campaign = await seedCampaign();
    const res = await request(app)
      .post(`/api/v1/campaigns/${campaign._id}/members`)
      .set('Authorization', auth(adminUser))
      .send({ members: [{ email: 'One@X.com', name: 'One' }, { email: 'two@x.com', name: 'Two' }] })
      .expect(200);

    expect(res.body.accepted).toBe(2);
    expect(await CampaignMember.countDocuments({ campaign: campaign._id })).toBe(2);
    // Stored lowercased so eligibility matching cannot miss on case.
    expect(await CampaignMember.findOne({ campaign: campaign._id, email: 'one@x.com' })).toBeTruthy();
  });

  it('reports the funnel and remaining exposure', async () => {
    const campaign = await seedCampaign();
    await CampaignMember.create({ campaign: campaign._id, email: 'a@x.com' });

    const res = await request(app)
      .get(`/api/v1/campaigns/${SLUG}/report`)
      .set('Authorization', auth(adminUser))
      .expect(200);

    expect(res.body.report.members.total).toBe(1);
    expect(res.body.report.redeemedCount).toBe(0);
    expect(res.body.report.remainingExposureRupees).toBe(100 * 50000);
  });
});
