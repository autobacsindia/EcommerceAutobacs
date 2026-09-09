/**
 * Affiliate enrolment + admin lifecycle over HTTP.
 *
 * The cases here are the ones a click-through misses: that the public application form
 * grants nothing and cannot be used as a membership oracle, that approving is ATOMIC
 * (an active affiliate can never exist without its coupon, and vice versa), that
 * suspension actually stops the discount rather than only the commission, and that the
 * admin surface is closed to a signed-in ordinary customer — not just to anonymous
 * callers, which is the guard people usually remember to write.
 */

import mongoose from 'mongoose';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { jest } from '@jest/globals';
import { app, cronService, adaptiveThrottlingService } from '../app.js';
import * as dbHandler from './db-handler.js';
import User from '../models/User.js';
import Affiliate from '../models/Affiliate.js';
import Coupon from '../models/Coupon.js';
import { AFFILIATE_STATUS } from '../config/affiliate.js';
import { CURRENT_AFFILIATE_TERMS_VERSION } from '../config/legalDocuments.js';
import { decryptField, isEncrypted } from '../utils/fieldEncryption.js';
import affiliateRepository from '../repositories/affiliateRepository.js';

const BASE = '/api/v1';

function extractCsrfFromSetCookie(setCookieHeader = []) {
  const xsrf = (setCookieHeader || []).find((c) => c.startsWith('XSRF-TOKEN='));
  return xsrf ? xsrf.split(';')[0].split('=')[1] : '';
}

/**
 * An anonymous browser: a fresh cookie jar plus a CSRF token.
 *
 * The public application form is CSRF-protected like every other non-GET, so a caller
 * must first fetch a token — exactly what the real frontend's tokenManager does before
 * any mutation. Posting without one is a 403, and that is the correct answer.
 */
async function anonymous() {
  const jar = request.agent(app);
  const res = await jar.get(`${BASE}/csrf-token`);
  const token = extractCsrfFromSetCookie(res.headers['set-cookie'])
    || res.body?.csrfToken
    || '';
  return {
    apply: (body) => jar.post(`${BASE}/affiliates/apply`).set('X-XSRF-TOKEN', token).send(body),
  };
}

/*
  The application now carries PAN, bank details and an address — everything needed to pay
  someone, collected up front so it is not chased from a person who has already earned.
*/
const APPLICATION = {
  name: 'Rahul Nair',
  email: 'rahul@example.com',
  phone: '9876543210',
  website: 'https://rahulreviews.example.com',
  pitch: 'I run a car-accessories review channel.',
  panNumber: 'ABCDE1234F',
  accountHolderName: 'Rahul Nair',
  accountNumber: '123456789012',
  ifsc: 'HDFC0001234',
  address: {
    line1: '12 MG Road',
    city: 'Kochi',
    state: 'Kerala',
    postalCode: '682001',
  },
  acceptTerms: true,
};

describe('Affiliate API', () => {
  let agent;
  let csrfToken;
  let shopperAgent;
  let shopperCsrf;

  const admin = {
    name: 'Affiliate Admin',
    email: 'affadmin@example.com',
    password: 'SecurePass123!',
    role: 'admin',
  };
  const shopper = {
    name: 'Affiliate Shopper',
    email: 'affshopper@example.com',
    password: 'SecurePass123!',
    role: 'customer',
  };

  // FIELD_ENCRYPTION_KEY comes from tests/setupEnv.js — the application writes encrypted
  // fields, and encryptField refuses to run without a key rather than storing plaintext.
  beforeAll(async () => { await dbHandler.connect(); });

  afterEach(async () => {
    await dbHandler.clearDatabase();
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });

  beforeEach(async () => {
    const salt = await bcrypt.genSalt(10);
    await User.create({
      name: admin.name, email: admin.email, role: admin.role,
      passwordHash: await bcrypt.hash(admin.password, salt),
    });
    await User.create({
      name: shopper.name, email: shopper.email, role: shopper.role,
      passwordHash: await bcrypt.hash(shopper.password, salt),
    });

    agent = request.agent(app);
    const login = await agent.post(`${BASE}/auth/login`)
      .send({ email: admin.email, password: admin.password });
    csrfToken = extractCsrfFromSetCookie(login.headers['set-cookie']);

    shopperAgent = request.agent(app);
    const shopperLogin = await shopperAgent.post(`${BASE}/auth/login`)
      .send({ email: shopper.email, password: shopper.password });
    shopperCsrf = extractCsrfFromSetCookie(shopperLogin.headers['set-cookie']);
  });

  const post = (url, body) => agent.post(`${BASE}${url}`).set('X-XSRF-TOKEN', csrfToken).send(body);
  const patch = (url, body) => agent.patch(`${BASE}${url}`).set('X-XSRF-TOKEN', csrfToken).send(body);
  const put = (url, body) => agent.put(`${BASE}${url}`).set('X-XSRF-TOKEN', csrfToken).send(body);
  const get = (url) => agent.get(`${BASE}${url}`);

  /** Apply anonymously, then approve as admin. Returns the live affiliate document. */
  const createActiveAffiliate = async (overrides = {}, approveBody = {}) => {
    await (await anonymous()).apply({ ...APPLICATION, ...overrides });
    const created = await Affiliate.findOne({ email: (overrides.email || APPLICATION.email).toLowerCase() });
    const res = await post(`/affiliates/admin/${created._id}/approve`, {
      commissionPercent: 10,
      discountPercent: 8,
      ...approveBody,
    });
    expect(res.status).toBe(200);
    return Affiliate.findById(created._id);
  };

  // ── Public application ──────────────────────────────────────────────────────

  describe('POST /affiliates/apply', () => {
    it('accepts an anonymous application and records it as pending', async () => {
      const res = await (await anonymous()).apply(APPLICATION);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      const stored = await Affiliate.findOne({ email: 'rahul@example.com' });
      expect(stored.status).toBe(AFFILIATE_STATUS.PENDING);
    });

    /*
      A pending affiliate must grant NOTHING. This is what makes an unauthenticated
      application form safe: approval is the capability boundary, not submission.
    */
    it('grants no coupon and no code until an admin approves', async () => {
      await (await anonymous()).apply(APPLICATION);

      const stored = await Affiliate.findOne({ email: 'rahul@example.com' });
      expect(stored.coupon).toBeNull();
      expect(stored.code).toBeUndefined();
      expect(await Coupon.countDocuments({})).toBe(0);
    });

    /*
      The endpoint is unauthenticated, so echoing the stored record back would make it
      a membership oracle: POST an email, read the response, learn whether that person
      is an affiliate and on what commission. It must reveal nothing beyond "received".
    */
    it('does not leak the stored record back to an anonymous caller', async () => {
      const res = await (await anonymous()).apply(APPLICATION);

      const body = JSON.stringify(res.body);
      expect(body).not.toMatch(/commissionPercent/);
      expect(body).not.toMatch(/_id/);
      expect(res.body.affiliate).toBeUndefined();
    });

    it('is idempotent for a repeat submission — no second row to reconcile', async () => {
      await (await anonymous()).apply(APPLICATION);
      const second = await (await anonymous()).apply(APPLICATION);

      expect(second.status).toBe(201);
      expect(await Affiliate.countDocuments({ email: 'rahul@example.com' })).toBe(1);
    });

    /*
      ⚠️ THE MEMBERSHIP ORACLE.

      This endpoint is unauthenticated, so ANY observable difference keyed on the
      submitted email leaks membership: POST an address, diff the response, learn whether
      that person is an affiliate and whether they were turned down. It previously
      returned 409 for active, 409 (different message) for rejected, and 201 for pending,
      and echoed `status` in the body — three separate channels for the same leak, behind
      a body comment claiming the leak was closed.
    */
    it('is byte-identical for a new applicant, an active affiliate and a rejected one', async () => {
      const first = await (await anonymous()).apply(APPLICATION);

      await createActiveAffiliate({ email: 'active@example.com' });
      const active = await (await anonymous()).apply({ ...APPLICATION, email: 'active@example.com' });

      await (await anonymous()).apply({ ...APPLICATION, email: 'rejected@example.com' });
      const rejectedRow = await Affiliate.findOne({ email: 'rejected@example.com' });
      await post(`/affiliates/admin/${rejectedRow._id}/reject`, {});
      const rejected = await (await anonymous()).apply({ ...APPLICATION, email: 'rejected@example.com' });

      for (const res of [active, rejected]) {
        expect(res.status).toBe(first.status);
        expect(res.body).toEqual(first.body);
      }
      expect(JSON.stringify(first.body)).not.toMatch(/pending|active|rejected|suspended/);
    });

    it('never mutates an existing application when it is re-submitted', async () => {
      const affiliate = await createActiveAffiliate();

      await (await anonymous()).apply(APPLICATION);

      const after = await Affiliate.findById(affiliate._id);
      expect(after.status).toBe(AFFILIATE_STATUS.ACTIVE);
      expect(await Affiliate.countDocuments({})).toBe(1);
    });

    /*
      `user` is a self-referral match key. Taking it from the body would let an
      applicant point their affiliate row at somebody else's account and defeat the
      check entirely — so it comes only from the verified session.
    */
    it('links a signed-in applicant to their own account, ignoring any user in the body', async () => {
      const otherUser = await User.findOne({ email: admin.email });

      await shopperAgent.post(`${BASE}/affiliates/apply`)
        .set('X-XSRF-TOKEN', shopperCsrf)
        .send({ ...APPLICATION, user: otherUser._id.toString() });

      const stored = await Affiliate.findOne({ email: 'rahul@example.com' });
      const shopperUser = await User.findOne({ email: shopper.email });
      expect(String(stored.user)).toBe(String(shopperUser._id));
    });

    it.each([
      ['a missing name', { ...APPLICATION, name: '' }],
      ['a malformed email', { ...APPLICATION, email: 'not-an-email' }],
      ['a javascript: website', { ...APPLICATION, website: 'javascript:alert(1)' }],
      ['an over-long pitch', { ...APPLICATION, pitch: 'x'.repeat(2001) }],
      ['a missing PAN', { ...APPLICATION, panNumber: '' }],
      ['a malformed PAN', { ...APPLICATION, panNumber: 'ABC123' }],
      ['a missing account number', { ...APPLICATION, accountNumber: '' }],
      ['a non-numeric account number', { ...APPLICATION, accountNumber: '12-34-56' }],
      ['a malformed IFSC', { ...APPLICATION, ifsc: 'NOPE' }],
      ['a missing phone', { ...APPLICATION, phone: '' }],
      ['a landline-shaped phone', { ...APPLICATION, phone: '0484123456' }],
      ['a missing channel link', { ...APPLICATION, website: '' }],
      ['an invented state', { ...APPLICATION, address: { ...APPLICATION.address, state: 'Kerela' } }],
      ['a missing PIN code', { ...APPLICATION, address: { ...APPLICATION.address, postalCode: '' } }],
      ['a PIN code starting with 0', { ...APPLICATION, address: { ...APPLICATION.address, postalCode: '082001' } }],
    ])('rejects %s with a 400', async (_label, body) => {
      const res = await (await anonymous()).apply(body);
      expect(res.status).toBe(400);
      expect(await Affiliate.countDocuments({})).toBe(0);
    });

    /*
      The T&C carry the commission basis, the payout cycle, the TDS disclosure, the
      no-self-referral rule and a termination clause. An application that skipped the box
      would be someone bound by terms they never saw.
    */
    it('refuses an application that did not accept the terms', async () => {
      const { acceptTerms: _omitted, ...withoutConsent } = APPLICATION;

      const res = await (await anonymous()).apply(withoutConsent);

      expect(res.status).toBe(400);
      expect(await Affiliate.countDocuments({})).toBe(0);
    });

    it('records WHICH terms version was accepted, from server config', async () => {
      await (await anonymous()).apply(APPLICATION);

      const stored = await Affiliate.findOne({ email: 'rahul@example.com' });
      expect(stored.termsAcceptance.version).toBe(CURRENT_AFFILIATE_TERMS_VERSION);
      expect(stored.termsAcceptance.acceptedAt).toBeTruthy();
      // Hashed, never the raw address.
      expect(stored.termsAcceptance.ipHash).toMatch(/^[a-f0-9]{64}$/);
    });

    /*
      A client that could name its own version could choose which contract to be bound
      by — so the version is server state, never request input.
    */
    it('ignores a terms version supplied by the client', async () => {
      await (await anonymous()).apply({
        ...APPLICATION,
        termsAcceptance: { version: '1999-01-01' },
        termsVersion: '1999-01-01',
      });

      const stored = await Affiliate.findOne({ email: 'rahul@example.com' });
      expect(stored.termsAcceptance.version).toBe(CURRENT_AFFILIATE_TERMS_VERSION);
    });

    it('stores the address for GST place of supply', async () => {
      await (await anonymous()).apply(APPLICATION);

      const stored = await Affiliate.findOne({ email: 'rahul@example.com' });
      expect(stored.address.state).toBe('Kerala');
      expect(stored.address.postalCode).toBe('682001');
      expect(stored.address.country).toBe('India');
    });

    it('accepts a valid GSTIN and rejects a malformed one', async () => {
      const ok = await (await anonymous()).apply({ ...APPLICATION, gstin: '32ABCDE1234F1Z5' });
      expect(ok.status).toBe(201);

      const bad = await (await anonymous()).apply({
        ...APPLICATION, email: 'other@example.com', gstin: 'NOTAGSTIN',
      });
      expect(bad.status).toBe(400);
    });

    // ── Encryption at rest ────────────────────────────────────────────────────
    /*
      ⚠️ THE POINT OF THE WHOLE EXERCISE. These arrive on a PUBLIC form and sit in the
      database for years. Asserted against the RAW collection, not the model, because a
      Mongoose read could mask plaintext behind a getter and pass for the wrong reason.
    */
    it('stores the PAN and account number encrypted, never in plaintext', async () => {
      await (await anonymous()).apply(APPLICATION);

      const raw = await mongoose.connection.db
        .collection('affiliates')
        .findOne({ email: 'rahul@example.com' });

      expect(isEncrypted(raw.payoutDetails.accountNumber)).toBe(true);
      expect(isEncrypted(raw.payoutDetails.panNumber)).toBe(true);
      expect(JSON.stringify(raw)).not.toContain('123456789012');
      expect(JSON.stringify(raw)).not.toContain('ABCDE1234F');

      // …and they round-trip, so this is encryption rather than destruction.
      expect(decryptField(raw.payoutDetails.accountNumber)).toBe('123456789012');
      expect(decryptField(raw.payoutDetails.panNumber)).toBe('ABCDE1234F');
    });

    it('derives accountLast4 from the plaintext, and leaves the IFSC readable', async () => {
      await (await anonymous()).apply(APPLICATION);

      const stored = await Affiliate.findOne({ email: 'rahul@example.com' });
      expect(stored.payoutDetails.accountLast4).toBe('9012');
      // An IFSC identifies a bank branch, not a person — public information.
      expect(stored.payoutDetails.ifsc).toBe('HDFC0001234');
    });
  });

  // ── Admin guard matrix ──────────────────────────────────────────────────────

  describe('admin routes are closed to everyone else', () => {
    /*
      Both limbs matter. Anonymous is the guard everybody writes; a SIGNED-IN ORDINARY
      CUSTOMER is the one that gets forgotten, and it is the one that matters — these
      routes expose every affiliate's terms and, on the payout route, bank details.
    */
    it.each([
      ['GET', '/affiliates/admin'],
      ['GET', '/affiliates/admin/stale-pending'],
    ])('%s %s rejects an anonymous caller', async (method, url) => {
      const res = await request(app)[method.toLowerCase()](`${BASE}${url}`);
      expect(res.status).toBe(401);
    });

    it('rejects a signed-in customer from the affiliate list', async () => {
      const res = await shopperAgent.get(`${BASE}/affiliates/admin`);
      expect(res.status).toBe(403);
    });

    it('rejects a signed-in customer from approving an affiliate', async () => {
      await (await anonymous()).apply(APPLICATION);
      const created = await Affiliate.findOne({});

      const res = await shopperAgent
        .post(`${BASE}/affiliates/admin/${created._id}/approve`)
        .set('X-XSRF-TOKEN', shopperCsrf)
        .send({ commissionPercent: 90 });

      expect(res.status).toBe(403);
      expect((await Affiliate.findById(created._id)).status).toBe(AFFILIATE_STATUS.PENDING);
    });
  });

  // ── Approval ────────────────────────────────────────────────────────────────

  describe('approval mints the managed coupon', () => {
    it('creates a hidden, first-order-only percentage coupon matching the affiliate', async () => {
      const affiliate = await createActiveAffiliate();

      expect(affiliate.status).toBe(AFFILIATE_STATUS.ACTIVE);
      expect(affiliate.code).toBe('RAHULNAIR');

      const coupon = await Coupon.findById(affiliate.coupon);
      expect(coupon.code).toBe('RAHULNAIR');
      expect(coupon.type).toBe('percentage');
      expect(coupon.value).toBe(8);
      // Hidden: a listed code is harvested by coupon sites within days, and every one
      // of those redemptions would pay commission on a sale nobody referred.
      expect(coupon.visibility).toBe('hidden');
      // Defaults ON — repeat-customer harvesting is the biggest silent leak.
      expect(coupon.firstOrderOnly).toBe(true);
      expect(coupon.isActive).toBe(true);
      expect(String(coupon.affiliate)).toBe(String(affiliate._id));
    });

    it('never lists an affiliate coupon among the public ones', async () => {
      await createActiveAffiliate();

      const res = await request(app).get(`${BASE}/coupons/available`);
      expect(res.status).toBe(200);
      const codes = JSON.stringify(res.body);
      expect(codes).not.toMatch(/RAHULNAIR/);
    });

    it('accepts an explicit code over the derived one', async () => {
      const affiliate = await createActiveAffiliate({}, { code: 'RAHUL10' });
      expect(affiliate.code).toBe('RAHUL10');
      expect((await Coupon.findById(affiliate.coupon)).code).toBe('RAHUL10');
    });

    it('rejects a malformed explicit code before anything is written', async () => {
      await (await anonymous()).apply(APPLICATION);
      const created = await Affiliate.findOne({});

      const res = await post(`/affiliates/admin/${created._id}/approve`, { code: 'a b!' });
      expect(res.status).toBe(400);
      expect((await Affiliate.findById(created._id)).status).toBe(AFFILIATE_STATUS.PENDING);
      expect(await Coupon.countDocuments({})).toBe(0);
    });

    it('is idempotent — a double-clicked Approve does not mint a second coupon', async () => {
      const affiliate = await createActiveAffiliate();

      const again = await post(`/affiliates/admin/${affiliate._id}/approve`, {});
      expect(again.status).toBe(200);
      expect(await Coupon.countDocuments({})).toBe(1);
    });

    /*
      Atomicity. If the coupon cannot be created the affiliate must NOT go active —
      otherwise their code is live in the admin, prints on their marketing, and
      discounts nothing.
    */
    it('leaves the affiliate pending when the code is already taken', async () => {
      await Coupon.create({ code: 'TAKEN10', type: 'percentage', value: 5 });
      await (await anonymous()).apply(APPLICATION);
      const created = await Affiliate.findOne({});

      const res = await post(`/affiliates/admin/${created._id}/approve`, { code: 'TAKEN10' });

      expect(res.status).toBe(409);
      const after = await Affiliate.findById(created._id);
      expect(after.status).toBe(AFFILIATE_STATUS.PENDING);
      expect(after.coupon).toBeNull();
      expect(await Coupon.countDocuments({})).toBe(1); // only the pre-existing one
    });

    it('sets a 0% discount coupon inactive so nobody "applies" a code worth nothing', async () => {
      const affiliate = await createActiveAffiliate({}, { discountPercent: 0 });
      expect((await Coupon.findById(affiliate.coupon)).isActive).toBe(false);
    });
  });

  // ── Suspension ──────────────────────────────────────────────────────────────

  describe('suspension stops the discount, not just the commission', () => {
    /*
      The point of doing both in one transaction. Flipping only the status would leave
      the code discounting — so we would keep giving away margin for promotion we have
      explicitly withdrawn.
    */
    it('deactivates the managed coupon in the same operation', async () => {
      const affiliate = await createActiveAffiliate();

      const res = await post(`/affiliates/admin/${affiliate._id}/suspend`, { reason: 'Fraud review' });
      expect(res.status).toBe(200);

      expect((await Affiliate.findById(affiliate._id)).status).toBe(AFFILIATE_STATUS.SUSPENDED);
      expect((await Coupon.findById(affiliate.coupon)).isActive).toBe(false);
    });

    it('reinstating reactivates both', async () => {
      const affiliate = await createActiveAffiliate();
      await post(`/affiliates/admin/${affiliate._id}/suspend`, {});

      const res = await post(`/affiliates/admin/${affiliate._id}/reinstate`, {});
      expect(res.status).toBe(200);

      expect((await Affiliate.findById(affiliate._id)).status).toBe(AFFILIATE_STATUS.ACTIVE);
      expect((await Coupon.findById(affiliate.coupon)).isActive).toBe(true);
    });

    it('refuses to reinstate someone who was never approved', async () => {
      await (await anonymous()).apply(APPLICATION);
      const created = await Affiliate.findOne({});

      const res = await post(`/affiliates/admin/${created._id}/reinstate`, {});
      expect(res.status).toBe(400);
    });
  });

  // ── Terms ───────────────────────────────────────────────────────────────────

  describe('PATCH terms', () => {
    it('mirrors a changed buyer discount onto the managed coupon', async () => {
      const affiliate = await createActiveAffiliate();

      const res = await patch(`/affiliates/admin/${affiliate._id}/terms`, { discountPercent: 12 });
      expect(res.status).toBe(200);

      expect((await Coupon.findById(affiliate.coupon)).value).toBe(12);
    });

    /*
      The commission rate is deliberately NOT mirrored anywhere. It is snapshotted onto
      each order at creation and the ledger reads the snapshot, so a rate change affects
      future orders only — raising someone's rate must never repay settled orders.
    */
    it('does not write the commission rate onto the coupon', async () => {
      const affiliate = await createActiveAffiliate();

      await patch(`/affiliates/admin/${affiliate._id}/terms`, { commissionPercent: 25 });

      const coupon = await Coupon.findById(affiliate.coupon);
      expect(coupon.value).toBe(8); // buyer discount, untouched by a commission change
      expect((await Affiliate.findById(affiliate._id)).commissionPercent).toBe(25);
    });

    it('deactivates the coupon when the discount is dropped to 0', async () => {
      const affiliate = await createActiveAffiliate();

      await patch(`/affiliates/admin/${affiliate._id}/terms`, { discountPercent: 0 });
      expect((await Coupon.findById(affiliate.coupon)).isActive).toBe(false);
    });

    it.each([
      ['a commission above 100%', { commissionPercent: 150 }],
      ['a negative commission', { commissionPercent: -5 }],
      ['a discount above 100%', { discountPercent: 101 }],
    ])('rejects %s', async (_label, body) => {
      const affiliate = await createActiveAffiliate();
      const res = await patch(`/affiliates/admin/${affiliate._id}/terms`, body);
      expect(res.status).toBe(400);
    });
  });

  // ── Payout details (financial PII) ──────────────────────────────────────────

  describe('PUT payout-details', () => {
    const BANK = {
      accountHolderName: 'Rahul Nair',
      accountNumber: '123456789012',
      ifsc: 'HDFC0001234',
      panNumber: 'ABCDE1234F',
    };

    it('stores the details ENCRYPTED and derives accountLast4', async () => {
      const affiliate = await createActiveAffiliate();

      const res = await put(`/affiliates/admin/${affiliate._id}/payout-details`, BANK);
      expect(res.status).toBe(200);

      const stored = await Affiliate.findById(affiliate._id)
        .select('+payoutDetails.accountNumber +payoutDetails.panNumber');
      // At rest it is ciphertext — the admin write path encrypts exactly as the public
      // application path does, because both go through the same schema setter.
      expect(isEncrypted(stored.payoutDetails.accountNumber)).toBe(true);
      expect(stored.payoutDetails.accountLast4).toBe('9012');

      // And the one sanctioned reader gets it back in the clear.
      const secrets = await affiliateRepository.readPayoutSecrets(affiliate._id);
      expect(secrets.accountNumber).toBe('123456789012');
      expect(secrets.panNumber).toBe('ABCDE1234F');
    });

    /*
      ⚠️ The affiliate T&C state plainly: "If your application is declined, we delete your
      PAN and bank details." The form collects them from people we have not accepted yet,
      so a decline that left them in place would be stranded financial PII AND a false
      statement in a document the applicant agreed to.
    */
    it('purges the PAN and bank details when an application is declined', async () => {
      await (await anonymous()).apply(APPLICATION);
      const applicant = await Affiliate.findOne({ email: 'rahul@example.com' });

      const res = await post(`/affiliates/admin/${applicant._id}/reject`, {});
      expect(res.status).toBe(200);

      const raw = await mongoose.connection.db
        .collection('affiliates')
        .findOne({ _id: applicant._id });

      // The application record survives — an admin must still see this email was
      // considered — but nothing that identifies a bank account remains.
      expect(raw.status).toBe(AFFILIATE_STATUS.REJECTED);
      expect(raw.email).toBe('rahul@example.com');
      expect(raw.payoutDetails?.accountNumber).toBeUndefined();
      expect(raw.payoutDetails?.panNumber).toBeUndefined();
      expect(raw.payoutDetails?.accountLast4).toBeUndefined();
      expect(raw.payoutDetails?.ifsc).toBeUndefined();
    });

    /*
      Write-only from the API's point of view. The response is a re-read WITHOUT the
      sensitive projection, so an admin console — or anything logging responses — never
      holds a full account number or PAN.
    */
    it('never echoes the account number or PAN back in the response', async () => {
      const affiliate = await createActiveAffiliate();

      const res = await put(`/affiliates/admin/${affiliate._id}/payout-details`, BANK);

      const body = JSON.stringify(res.body);
      expect(body).not.toMatch(/123456789012/);
      expect(body).not.toMatch(/ABCDE1234F/);
      expect(res.body.affiliate.payoutDetails.accountLast4).toBe('9012');
    });

    it('keeps them out of the admin list and the detail view too', async () => {
      const affiliate = await createActiveAffiliate();
      await put(`/affiliates/admin/${affiliate._id}/payout-details`, BANK);

      const list = await get('/affiliates/admin');
      const detail = await get(`/affiliates/admin/${affiliate._id}`);

      for (const res of [list, detail]) {
        const body = JSON.stringify(res.body);
        expect(body).not.toMatch(/123456789012/);
        expect(body).not.toMatch(/ABCDE1234F/);
      }
    });

    it.each([
      ['a malformed IFSC', { ifsc: 'NOPE1' }],
      ['a malformed PAN', { panNumber: 'ABC123' }],
      ['a non-numeric account number', { accountNumber: '12-34-56' }],
    ])('rejects %s', async (_label, body) => {
      const affiliate = await createActiveAffiliate();
      const res = await put(`/affiliates/admin/${affiliate._id}/payout-details`, body);
      expect(res.status).toBe(400);
    });
  });

  // ── Self-serve ──────────────────────────────────────────────────────────────

  describe('GET /affiliates/me', () => {
    it('answers null for an ordinary customer rather than erroring', async () => {
      const res = await shopperAgent.get(`${BASE}/affiliates/me`);
      expect(res.status).toBe(200);
      expect(res.body.affiliate).toBeNull();
    });

    it('requires authentication', async () => {
      const res = await request(app).get(`${BASE}/affiliates/me`);
      expect(res.status).toBe(401);
    });

    it('returns the caller\'s own profile and balance', async () => {
      await shopperAgent.post(`${BASE}/affiliates/apply`)
        .set('X-XSRF-TOKEN', shopperCsrf)
        .send({ ...APPLICATION, email: shopper.email });
      const created = await Affiliate.findOne({ email: shopper.email });
      await post(`/affiliates/admin/${created._id}/approve`, { commissionPercent: 10, discountPercent: 5 });

      const res = await shopperAgent.get(`${BASE}/affiliates/me`);
      expect(res.status).toBe(200);
      expect(res.body.affiliate.code).toBeTruthy();
      expect(res.body.payableBalancePaise).toBe(0);
    });

    it('refuses the ledger to a caller who is not an affiliate', async () => {
      const res = await shopperAgent.get(`${BASE}/affiliates/me/commissions`);
      expect(res.status).toBe(403);
    });
  });

  // ── Listing ─────────────────────────────────────────────────────────────────

  describe('GET /affiliates/admin', () => {
    it('is cursor-paginated and bounded', async () => {
      for (let i = 0; i < 3; i += 1) {
        await (await anonymous()).apply({ ...APPLICATION, name: `Person ${i}`, email: `p${i}@example.com` });
      }

      const first = await get('/affiliates/admin?limit=2');
      expect(first.body.affiliates).toHaveLength(2);
      expect(first.body.nextCursor).toBeTruthy();

      const second = await get(`/affiliates/admin?limit=2&before=${encodeURIComponent(first.body.nextCursor)}`);
      expect(second.body.affiliates).toHaveLength(1);
      expect(second.body.nextCursor).toBeNull();

      // No overlap between pages — the cursor is exclusive.
      const ids = new Set(first.body.affiliates.map((a) => a._id));
      expect(ids.has(second.body.affiliates[0]._id)).toBe(false);
    });

    it('rejects an over-large limit rather than silently serving it', async () => {
      const res = await get('/affiliates/admin?limit=5000');
      expect(res.status).toBe(400);
    });

    it('filters by status', async () => {
      await createActiveAffiliate();
      await (await anonymous()).apply({ ...APPLICATION, name: 'Pending Person', email: 'pending@example.com' });

      const res = await get('/affiliates/admin?status=pending');
      expect(res.body.affiliates).toHaveLength(1);
      expect(res.body.affiliates[0].email).toBe('pending@example.com');
    });
  });
});
