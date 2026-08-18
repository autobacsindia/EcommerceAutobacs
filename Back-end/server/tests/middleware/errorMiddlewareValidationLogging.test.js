import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import SeoSchema from '../../models/shared/seoSchema.js';
import { errorHandler } from '../../middleware/errorMiddleware.js';

/**
 * A Mongoose ValidationError must be DIAGNOSABLE from the logs.
 *
 * The handler deliberately whitelists the client-facing message down to the bare
 * string "Validation Error" — it will not echo raw model errors as the top-level
 * message. That is the right call for the response, but it also meant the LOG
 * line carried nothing but that same opaque string plus a stack, so a 400 in
 * Railway named no field. Diagnosing a real one (a product that could not be
 * saved because `seo.canonical` breached its maxlength) took a full offline
 * reproduction of Mongoose's update validators to identify the field.
 *
 * These tests pin both halves of the contract: the per-field map goes to the log
 * AND to the response, while the opaque top-level message stays opaque.
 */

const ValidationHost = mongoose.model(
  'ErrorMiddlewareValidationHost',
  new mongoose.Schema({
    seo: { type: SeoSchema, default: () => ({}) },
    name: { type: String, required: true },
  })
);

/** A real Mongoose ValidationError — not a hand-built stub. */
const realValidationError = () =>
  new ValidationHost({
    seo: { canonical: 'https://autobacsindia.com/' + 'a'.repeat(600) },
  }).validateSync();

const makeReq = () => ({
  requestId: 'test-request-id',
  originalUrl: '/api/v1/products/69aec460981d9f26abdfbf2e',
  method: 'PUT',
  ip: '3.110.197.248',
  headers: { 'user-agent': 'jest' },
  user: { _id: 'admin-id', role: 'admin' },
  body: { name: 'A product' },
  params: {},
  query: {},
});

const makeRes = () => {
  const res = { headersSent: false, statusCode: null, payload: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.payload = body; return res; };
  return res;
};

/** Run the handler, returning the response plus every parsed console.error log line. */
const runHandler = (err) => {
  const res = makeRes();
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    errorHandler(err, makeReq(), res, () => {});
    const logs = spy.mock.calls
      .map(([first]) => { try { return JSON.parse(first); } catch { return null; } })
      .filter(Boolean);
    return { res, logs };
  } finally {
    jest.restoreAllMocks();
  }
};

describe('errorHandler — Mongoose ValidationError', () => {
  it('logs the per-field validation detail, naming the offending path', () => {
    const { logs } = runHandler(realValidationError());
    const log = logs.find((l) => l.level === 'error');

    expect(log).toBeDefined();
    expect(log.validationErrors).toBeDefined();
    // The whole point: the failing path is present in the log.
    expect(Object.keys(log.validationErrors)).toContain('seo.canonical');
    expect(log.validationErrors['seo.canonical']).toMatch(/maximum allowed length/i);
  });

  it('logs field detail even though the top-level message stays whitelisted', () => {
    const { logs, res } = runHandler(realValidationError());
    const log = logs.find((l) => l.level === 'error');

    expect(log.message).toBe('Validation Error'); // still opaque, by design
    expect(res.payload.message).toBe('Validation Error');
    expect(log.validationErrors['seo.canonical']).toEqual(expect.any(String));
  });

  it('classifies the error as an operational 400, not a 5xx page-someone event', () => {
    const { res, logs } = runHandler(realValidationError());
    const log = logs.find((l) => l.level === 'error');

    expect(res.statusCode).toBe(400);
    expect(log.statusCode).toBe(400);
    expect(log.isOperational).toBe(true);
  });

  it('still returns the per-field map to the client', () => {
    const { res } = runHandler(realValidationError());

    expect(res.payload.success).toBe(false);
    expect(res.payload.errors['seo.canonical']).toMatch(/maximum allowed length/i);
    expect(res.payload.errorId).toEqual(expect.any(String));
  });

  it('reports every failing field, not just the first', () => {
    // `name` is required and omitted; `seo.canonical` breaches its maxlength.
    const err = new ValidationHost({
      seo: { canonical: 'https://autobacsindia.com/' + 'a'.repeat(600) },
    }).validateSync();
    const { logs } = runHandler(err);
    const log = logs.find((l) => l.level === 'error');

    expect(Object.keys(log.validationErrors).sort()).toEqual(['name', 'seo.canonical']);
  });

  it('omits the field map entirely for errors that carry none', () => {
    const { logs, res } = runHandler(Object.assign(new Error('boom'), { statusCode: 500 }));
    const log = logs.find((l) => l.level === 'error');

    expect(log).not.toHaveProperty('validationErrors');
    expect(res.payload).not.toHaveProperty('errors');
  });
});
