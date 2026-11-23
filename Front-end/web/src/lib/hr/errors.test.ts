/** Every HR screen reads API failures through this one function. */
import { ApiError } from '@/lib/api-types';
import { describeHrError, isComingSoon } from './errors';

const err = (status: number, message: string) => new ApiError(status, message, '/api/v1/hr/x');

describe('describeHrError', () => {
  it('turns a missing route into "coming soon", not an error', () => {
    const v = describeHrError(err(404, 'Route not found'));
    expect(v.kind).toBe('comingSoon');
    expect(isComingSoon(err(404, 'Route not found'))).toBe(true);
  });

  it('treats any other 404 as not found / not yours (same answer on purpose)', () => {
    expect(describeHrError(err(404, 'Employee not found')).kind).toBe('notFound');
    expect(isComingSoon(err(404, 'Employee not found'))).toBe(false);
  });

  it('gives a friendly 403 that never echoes the server text', () => {
    const v = describeHrError(err(403, 'internal: hrOrAdmin failed for user 123'));
    expect(v.kind).toBe('forbidden');
    expect(v.message).not.toMatch(/internal|123/);
  });

  it('asks to sign in on 401', () => {
    expect(describeHrError(err(401, 'jwt expired')).kind).toBe('signin');
  });

  it('shows the server reason on 409 and 400/422 (they are person-readable by contract)', () => {
    expect(describeHrError(err(409, 'This profile was changed by someone else since you opened it.')).message).toMatch(/someone else/);
    expect(describeHrError(err(400, 'PAN must look like ABCDE1234F')).message).toBe('PAN must look like ABCDE1234F');
    expect(describeHrError(err(422, '')).kind).toBe('invalid');
  });

  it('hides 5xx and network details behind a generic message', () => {
    expect(describeHrError(err(500, 'MongoServerError: E11000')).message).not.toMatch(/Mongo/);
    expect(describeHrError(new TypeError('Failed to fetch')).kind).toBe('other');
    expect(describeHrError(undefined).kind).toBe('other');
  });
});
