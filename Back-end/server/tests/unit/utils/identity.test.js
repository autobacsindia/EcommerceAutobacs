import {
  normalizeEmail,
  normalizePhone,
  buildIdentityKey,
  escapeRegex,
  phoneSearchPattern,
} from '../../../utils/identity.js';

describe('identity helpers', () => {
  describe('normalizePhone', () => {
    it('reduces to the last 10 significant digits', () => {
      expect(normalizePhone('+91 98765 43210')).toBe('9876543210');
      expect(normalizePhone('09876543210')).toBe('9876543210');
      expect(normalizePhone('9876543210')).toBe('9876543210');
    });
    it('returns null for too-short / non-string input', () => {
      expect(normalizePhone('12345')).toBeNull();
      expect(normalizePhone('')).toBeNull();
      expect(normalizePhone(null)).toBeNull();
    });
  });

  describe('buildIdentityKey', () => {
    it('prefers email over phone', () => {
      expect(buildIdentityKey({ email: 'A@X.com', phone: '9876543210' })).toBe('email:a@x.com');
    });
    it('falls back to a phone key, else null', () => {
      expect(buildIdentityKey({ phone: '+91 98765 43210' })).toBe('phone:9876543210');
      expect(buildIdentityKey({})).toBeNull();
    });
  });

  describe('escapeRegex', () => {
    it('escapes regex metacharacters so input is matched literally', () => {
      expect(escapeRegex('a.b*c')).toBe('a\\.b\\*c');
      // A crafted term must not behave as a pattern.
      expect(new RegExp(escapeRegex('.*')).test('anything')).toBe(false);
      expect(new RegExp(escapeRegex('.*')).test('.*')).toBe(true);
    });
  });

  describe('phoneSearchPattern', () => {
    const matches = (query, stored) => new RegExp(phoneSearchPattern(query)).test(stored);

    it('matches the same number across separator/prefix variants', () => {
      const stored = ['+91 98765 43210', '09876543210', '9876543210', '919876543210', '98765-43210'];
      for (const s of stored) expect(matches('9876543210', s)).toBe(true);
    });
    it('does not match a different number', () => {
      expect(matches('9876543210', '1112223334')).toBe(false);
    });
    it('returns null for non-phone-like queries so callers can fall back', () => {
      expect(phoneSearchPattern('john')).toBeNull();
      expect(phoneSearchPattern('12345')).toBeNull();
    });
  });

  describe('normalizeEmail', () => {
    it('trims and lowercases, else null', () => {
      expect(normalizeEmail('  John@X.com ')).toBe('john@x.com');
      expect(normalizeEmail('')).toBeNull();
    });
  });
});
