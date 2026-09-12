/**
 * normaliseResponse — surfacing per-field validation detail.
 *
 * The backend whitelists a Mongoose ValidationError's message down to the bare
 * string "Validation Error" and carries the real detail in `errors`, which it
 * emits as an OBJECT keyed by path. Only the ARRAY shape was ever read here, so
 * that detail was dropped and the admin got a red box naming no field — four
 * failed careers saves on 2026-09-12 with the answer sitting in the response
 * body the whole time. Both shapes are covered below.
 */

import { normaliseResponse } from './errorNormaliser';
import { ApiError } from '../api-types';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    url: 'https://api.example.com/api/v1/careers/admin/postings/abc',
    headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

async function messageFrom(status: number, body: unknown): Promise<string> {
  try {
    await normaliseResponse(jsonResponse(status, body));
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    return (err as ApiError).message;
  }
  throw new Error('expected normaliseResponse to throw');
}

describe('object-shaped `errors` (mongoose ValidationError)', () => {
  test('names the offending path, length and cap', async () => {
    const message = await messageFrom(400, {
      success: false,
      message: 'Validation Error',
      errors: {
        'responsibilities.0':
          'Path `responsibilities.0` (`Cash flow management…`, length 653) is longer than the maximum allowed length (500).',
      },
    });

    expect(message).toContain('responsibilities.0');
    expect(message).toContain('653');
    expect(message).toContain('500');
    // The path is already inside the mongoose text — don't print it twice.
    expect(message.match(/responsibilities\.0/g)).toHaveLength(1);
  });

  test('prefixes the field when the message does not already name it', async () => {
    const message = await messageFrom(400, {
      message: 'Validation Error',
      errors: { email: 'is not a valid address' },
    });
    expect(message).toContain('email: is not a valid address');
  });

  test('caps the list at five fields and counts the rest', async () => {
    const errors: Record<string, string> = {};
    for (let i = 0; i < 8; i += 1) errors[`f${i}`] = `bad ${i}`;

    const message = await messageFrom(400, { message: 'Validation Error', errors });
    expect(message).toContain('f0: bad 0');
    expect(message).toContain('(+3 more)');
    expect(message).not.toContain('f7');
  });

  test('an empty error map leaves the message untouched', async () => {
    const message = await messageFrom(400, { message: 'Validation Error', errors: {} });
    expect(message).toBe('Validation Error');
  });
});

describe('array-shaped `errors` (express-validator) still works', () => {
  test('joins msg fields', async () => {
    const message = await messageFrom(400, {
      message: 'Validation failed',
      errors: [{ param: 'email', msg: 'Invalid email' }, { msg: 'Password too short' }],
    });
    expect(message).toContain('email: Invalid email');
    expect(message).toContain('Password too short');
  });

  test('plain strings pass through', async () => {
    const message = await messageFrom(400, { message: 'Nope', errors: ['Cart is empty'] });
    expect(message).toContain('Cart is empty');
  });

  test('all-generic detail falls back to a plain instruction, not noise', async () => {
    const message = await messageFrom(400, {
      message: 'Validation failed',
      errors: [{}, {}],
    });
    expect(message).toBe('Validation failed. Please check your input and try again.');
  });
});

describe('no `errors` key', () => {
  test('the message is passed through unchanged', async () => {
    const message = await messageFrom(400, { message: 'Role not found' });
    expect(message).toBe('Role not found');
  });

  test('a non-JSON string body does not blow up the object branch', async () => {
    const message = await messageFrom(500, 'upstream exploded');
    expect(message).toBe('upstream exploded');
  });
});

describe('success responses', () => {
  test('a 200 returns parsed data rather than throwing', async () => {
    await expect(normaliseResponse(jsonResponse(200, { success: true, postings: [] })))
      .resolves.toEqual({ success: true, postings: [] });
  });
});
