import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getClientIp } from '../middleware/rate-limit/clientIp.js';
import * as limiters from '../middleware/rate-limit/index.js';
import { applyLocalEmergencyLimit } from '../middleware/rate-limit/emergencyLimiter.js';
import { paymentIdentityKey } from '../routes/razorpay.js';

/**
 * House rule: rate-limit by the real client IP. Behind Cloudflare `req.ip` is the
 * edge, so a limiter keyed on it puts every visitor in the country in ONE bucket —
 * it either never trips or trips for everyone at once.
 *
 * The limiter middleware returns early under NODE_ENV=test, so these tests drive
 * the key generators directly (exposed as `limiter.keyGenerator`). The shape of
 * every test: two visitors behind the same Cloudflare edge (same `req.ip`, different
 * `cf-connecting-ip`) must land in different buckets.
 */

const EDGE_IP = '172.68.10.1'; // one Cloudflare edge, shared by everyone below
const VISITOR_A = '49.36.1.10';
const VISITOR_B = '106.51.2.20';

const viaCloudflare = (clientIp, extra = {}) => ({
  ip: EDGE_IP,
  headers: { 'cf-connecting-ip': clientIp },
  connection: { remoteAddress: EDGE_IP },
  cookies: {},
  body: {},
  ...extra,
});

describe('getClientIp', () => {
  it('prefers cf-connecting-ip over req.ip', () => {
    expect(getClientIp(viaCloudflare(VISITOR_A))).toBe(VISITOR_A);
  });

  it('falls back to req.ip when there is no Cloudflare header (local dev, direct hits)', () => {
    expect(getClientIp({ ip: VISITOR_B, headers: {} })).toBe(VISITOR_B);
  });

  it('falls back to the socket address when req.ip is also missing', () => {
    expect(getClientIp({ headers: {}, connection: { remoteAddress: VISITOR_A } })).toBe(VISITOR_A);
  });

  it('tolerates a request with no headers object', () => {
    expect(getClientIp({ ip: VISITOR_A })).toBe(VISITOR_A);
  });
});

describe('core limiters key anonymous visitors on the real client IP', () => {
  // Limiters whose anonymous key is "<prefix>:<ip>" — the prefix is unchanged so
  // the Redis counters already in production keep their meaning.
  const cases = [
    ['publicBrowsingRateLimit', 'rate_limit:public:'],
    ['paymentConfigRateLimit', 'rate_limit:payment-config:'],
    ['authenticatedUserRateLimit', 'rate_limit:user:'],
    ['checkoutRateLimit', 'rate_limit:checkout:'],
    ['returnsRateLimit', 'rate_limit:returns:'],
    ['spinRateLimit', 'rate_limit:spin:'],
    ['globalApiRateLimit', 'rate_limit:global:'],
    ['adminRouteRateLimit', 'rate_limit:admin:'],
    ['reviewSubmitRateLimit', 'rate_limit:review_submit:'],
    ['questionSubmitRateLimit', 'rate_limit:question_submit:'],
    ['questionAnswerRateLimit', 'rate_limit:question_answer:'],
    ['searchRateLimit', 'rate_limit:search:'],
    ['searchBurstLimit', 'rate_limit:search_burst:'],
    ['registerRateLimit', 'rate_limit:register:'],
    ['loginRateLimit', 'rate_limit:login:'],
    ['refreshTokenRateLimit', 'rate_limit:refresh:'],
    ['resetPasswordRateLimit', 'rate_limit:reset_password:'],
    ['magicLinkVerifyRateLimit', 'rate_limit:magic_link_verify:'],
    ['verifyEmailRateLimit', 'rate_limit:verify_email:'],
  ];

  it.each(cases)('%s: same edge, different visitors → different buckets', (name, prefix) => {
    const keyGenerator = limiters[name]?.keyGenerator;
    expect(typeof keyGenerator).toBe('function');

    const keyA = keyGenerator(viaCloudflare(VISITOR_A));
    const keyB = keyGenerator(viaCloudflare(VISITOR_B));

    expect(keyA).not.toBe(keyB);
    expect(keyA).toBe(`${prefix}${VISITOR_A}`);
    expect(keyA).not.toContain(EDGE_IP);
  });

  it('a signed-in user is still keyed on their user id, not their IP', () => {
    const { keyGenerator } = limiters.checkoutRateLimit;
    expect(keyGenerator(viaCloudflare(VISITOR_A, { user: { id: 'u1' } }))).toBe('rate_limit:checkout:u1');
  });

  it('limiters keyed on IP + email still separate visitors behind one edge', () => {
    const { keyGenerator } = limiters.authenticationRateLimit;
    const body = { email: 'a@example.com' };
    expect(keyGenerator(viaCloudflare(VISITOR_A, { body })))
      .not.toBe(keyGenerator(viaCloudflare(VISITOR_B, { body })));
  });

  it('limiters without a custom keyGenerator expose undefined (core default key applies)', () => {
    expect(limiters.wishlistRateLimit.keyGenerator).toBeUndefined();
  });
});

describe('razorpay payment limiters (express-rate-limit)', () => {
  it('guests without a session cookie are split by real client IP', () => {
    expect(paymentIdentityKey(viaCloudflare(VISITOR_A))).toBe(`ip:${VISITOR_A}`);
    expect(paymentIdentityKey(viaCloudflare(VISITOR_A)))
      .not.toBe(paymentIdentityKey(viaCloudflare(VISITOR_B)));
  });

  it('keeps identity precedence: user > guest session > IP', () => {
    expect(paymentIdentityKey(viaCloudflare(VISITOR_A, { user: { id: 'u1' }, cookies: { guest_session: 'g1' } }))).toBe('u1');
    expect(paymentIdentityKey(viaCloudflare(VISITOR_A, { cookies: { guest_session: 'g1' } }))).toBe('g1');
  });

  it('does not throw when cookie-parser has not populated req.cookies', () => {
    expect(paymentIdentityKey({ ip: VISITOR_B, headers: {} })).toBe(`ip:${VISITOR_B}`);
  });
});

describe('emergency (Redis-down) limiter', () => {
  const mockRes = () => {
    const res = {};
    res.set = jest.fn(() => res);
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    return res;
  };

  it('one noisy visitor behind an edge does not block a different visitor behind the same edge', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const noisy = '203.0.113.7';
    const quiet = '203.0.113.8';

    // Exhaust the noisy visitor's 10 req/s emergency allowance.
    let lastRes;
    for (let i = 0; i < 11; i += 1) {
      lastRes = mockRes();
      applyLocalEmergencyLimit(viaCloudflare(noisy), lastRes, () => {});
    }
    expect(lastRes.status).toHaveBeenCalledWith(429);

    const next = jest.fn();
    const res = mockRes();
    applyLocalEmergencyLimit(viaCloudflare(quiet), res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('regression guard: no limiter keys on bare req.ip', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const files = [
    ...fs.readdirSync(path.join(root, 'middleware/rate-limit'))
      .filter((f) => f.endsWith('.js'))
      .map((f) => path.join(root, 'middleware/rate-limit', f)),
    ...fs.readdirSync(path.join(root, 'routes'))
      .filter((f) => f.endsWith('.js'))
      .map((f) => path.join(root, 'routes', f)),
  ];

  it.each(files.map((f) => [path.relative(root, f), f]))('%s', (_rel, file) => {
    const src = fs.readFileSync(file, 'utf8');

    // A keyGenerator line that reads req.ip directly bypasses getClientIp.
    const offending = src
      .split('\n')
      .filter((line) => /keyGenerator/.test(line) && /\breq\.ip\b/.test(line));
    expect(offending).toEqual([]);

    // express-rate-limit's DEFAULT key is req.ip, so every limiter built from it
    // must pass an explicit keyGenerator.
    if (/from ['"]express-rate-limit['"]/.test(src)) {
      const blocks = src.split(/=\s*rateLimit\(\{/).slice(1);
      blocks.forEach((block) => {
        const body = block.slice(0, block.indexOf('});'));
        expect(body).toMatch(/keyGenerator/);
      });
    }
  });
});
