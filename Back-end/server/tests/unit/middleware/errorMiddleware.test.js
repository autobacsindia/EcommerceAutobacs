/**
 * errorHandler's normalization of raw Mongoose/driver errors.
 *
 * These errors carry no `statusCode`, so they used to fall through to the 500
 * default: the client got an opaque "Something went wrong", and — worse — every
 * bad admin form submit tripped the 5xx P1 alert.
 */

import { jest } from '@jest/globals';

const sendP1Alert = jest.fn();
jest.unstable_mockModule('../../../utils/alerting.js', () => ({ sendP1Alert }));

const { errorHandler } = await import('../../../middleware/errorMiddleware.js');

const makeRes = () => {
  const res = { headersSent: false };
  res.status = jest.fn().mockImplementation((code) => { res.statusCode = code; return res; });
  res.json = jest.fn().mockImplementation((body) => { res.body = body; return res; });
  return res;
};

const makeReq = (over = {}) => ({ originalUrl: '/api/v1/products', method: 'POST', body: {}, params: {}, query: {}, ...over });

const run = (err, req = makeReq()) => {
  const res = makeRes();
  errorHandler(err, req, res, jest.fn());
  return res;
};

/** An error raised deliberately by a controller (AppError shape). */
const appError = (message, statusCode) =>
  Object.assign(new Error(message), { statusCode, isOperational: true });

const asAdmin = () => makeReq({ user: { _id: 'a1', role: 'admin' } });
const asCustomer = () => makeReq({ user: { _id: 'u1', role: 'user' } });

// jest.config sets resetMocks:true, which wipes implementations before every
// test — so the resolved value has to be (re)installed here, not at construction.
beforeEach(() => {
  sendP1Alert.mockResolvedValue(undefined);
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('errorHandler — Mongoose error normalization', () => {
  it('maps a ValidationError to 400 and forwards per-field detail', () => {
    const err = Object.assign(new Error('Product validation failed: slug: Path `slug` is required.'), {
      name: 'ValidationError',
      errors: { slug: { message: 'Path `slug` is required.' } },
    });

    const res = run(err);

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe('Validation Error');
    expect(res.body.errors).toEqual({ slug: 'Path `slug` is required.' });
  });

  it('does not fire the P1 alert for a validation error', () => {
    run(Object.assign(new Error('bad'), { name: 'ValidationError', errors: { slug: { message: 'nope' } } }));
    expect(sendP1Alert).not.toHaveBeenCalled();
  });

  it('maps a CastError to 400', () => {
    const res = run(Object.assign(new Error('Cast to ObjectId failed'), { name: 'CastError' }));
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe('Validation Error');
  });

  it('maps a duplicate-key error to 409, naming the field but not the value', () => {
    const err = Object.assign(new Error('E11000 duplicate key'), {
      code: 11000,
      keyPattern: { slug: 1 },
      keyValue: { slug: 'bosch-wiper-blade' },
    });

    const res = run(err);

    expect(res.statusCode).toBe(409);
    expect(res.body.message).toBe('Duplicate value: slug already exists');
    expect(JSON.stringify(res.body)).not.toContain('bosch-wiper-blade');
  });

  it('leaves a genuine server fault as a 500 that still pages on-call', () => {
    const res = run(new Error('mongo connection lost'));

    expect(res.statusCode).toBe(500);
    expect(res.body.message).toBe('Something went wrong. Please try again later.');
    expect(res.body.message).not.toContain('mongo connection lost');
    expect(sendP1Alert).toHaveBeenCalledTimes(1);
  });

  it('never overrides a statusCode the caller already set', () => {
    const res = run(Object.assign(new Error('Product not found'), { statusCode: 404, isOperational: true }));
    expect(res.statusCode).toBe(404);
    expect(res.body.message).toBe('Product not found');
  });
});

/**
 * Admins get the real reason. The whitelist protects the PUBLIC surface; applying it
 * to the admin console turned every actionable message ("this refund exceeds what is
 * left on the order") into "Something went wrong", leaving the operator to guess.
 */
describe('errorHandler — message visibility by principal', () => {
  const dynamic = () => appError('Refund of ₹1450 exceeds what is left on this order (₹700).', 422);

  it('shows an authenticated admin the operational message verbatim', () => {
    const res = run(dynamic(), asAdmin());
    expect(res.statusCode).toBe(422);
    expect(res.body.message).toMatch(/exceeds what is left/);
  });

  it('still gives a customer the generic message for the same error', () => {
    const res = run(dynamic(), asCustomer());
    expect(res.statusCode).toBe(422);
    expect(res.body.message).toBe('Something went wrong. Please try again later.');
  });

  it('gives an anonymous caller the generic message', () => {
    expect(run(dynamic()).body.message).toBe('Something went wrong. Please try again later.');
  });

  it('withholds a NON-operational message even from an admin', () => {
    // Unexpected throws can carry connection strings or internal paths — never echo
    // them, regardless of who is asking.
    const res = run(new Error('connect ECONNREFUSED mongodb://user:pw@10.0.0.4:27017'), asAdmin());
    expect(res.body.message).toBe('Something went wrong. Please try again later.');
    expect(JSON.stringify(res.body)).not.toContain('27017');
  });
});

describe('errorHandler — P1 alerting is for unexpected faults only', () => {
  it('does not page on-call for an operational 502 (a gateway business rejection)', () => {
    const res = run(appError('Refund failed at the gateway: amount exceeds capture', 502), asAdmin());
    expect(res.statusCode).toBe(502);
    expect(sendP1Alert).not.toHaveBeenCalled();
  });

  it('still pages for an unexpected 500', () => {
    run(new Error('kaboom'));
    expect(sendP1Alert).toHaveBeenCalledTimes(1);
  });
});
