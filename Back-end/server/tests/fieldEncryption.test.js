/**
 * Field encryption — the layer standing between a database dump and someone's bank account.
 *
 * The cases that matter are the ones where a mistake is INVISIBLE: silently storing
 * plaintext because a key was missing, double-encrypting on a re-save so the value can
 * never be read back, or returning a corrupt string that looks like an account number to
 * whoever is about to make a transfer.
 */

import crypto from 'crypto';
import {
  encryptField,
  decryptField,
  isEncrypted,
  encryptionAvailable,
  lastFourOf,
} from '../utils/fieldEncryption.js';

const KEY_A = crypto.randomBytes(32).toString('base64');
const KEY_B = crypto.randomBytes(32).toString('base64');

const originalKey = process.env.FIELD_ENCRYPTION_KEY;
beforeEach(() => { process.env.FIELD_ENCRYPTION_KEY = KEY_A; });
afterAll(() => {
  if (originalKey === undefined) delete process.env.FIELD_ENCRYPTION_KEY;
  else process.env.FIELD_ENCRYPTION_KEY = originalKey;
});

describe('round trip', () => {
  it.each([
    ['a bank account number', '123456789012'],
    ['a PAN', 'ABCDE1234F'],
    ['a long account number', '9'.repeat(20)],
    ['a value with unicode', 'Rahul Näir ₹'],
  ])('encrypts and decrypts %s', (_label, plaintext) => {
    const encrypted = encryptField(plaintext);

    expect(encrypted).not.toBe(plaintext);
    expect(encrypted).not.toContain(plaintext);
    expect(isEncrypted(encrypted)).toBe(true);
    expect(decryptField(encrypted)).toBe(plaintext);
  });

  /*
    A fresh IV per call. Without it, two affiliates with the same bank would produce
    identical ciphertext — which leaks that they match, and makes a frequency attack on a
    short, structured value like a PAN meaningfully easier.
  */
  it('produces different ciphertext for the same plaintext each time', () => {
    const a = encryptField('123456789012');
    const b = encryptField('123456789012');

    expect(a).not.toBe(b);
    expect(decryptField(a)).toBe(decryptField(b));
  });

  it.each([[null], [undefined], ['']])('passes %p through untouched', (value) => {
    expect(encryptField(value)).toBe(value);
    expect(decryptField(value)).toBe(value);
  });
});

describe('idempotence', () => {
  /*
    Mongoose setters run on EVERY assignment, including re-saving an unchanged document.
    Without the format-prefix check, each save would wrap the previous ciphertext again
    and the value would become unrecoverable after the first one.
  */
  it('does not double-encrypt an already-encrypted value', () => {
    const once = encryptField('123456789012');
    const twice = encryptField(once);
    const thrice = encryptField(twice);

    expect(twice).toBe(once);
    expect(thrice).toBe(once);
    expect(decryptField(thrice)).toBe('123456789012');
  });
});

describe('missing key', () => {
  /*
    ⚠️ THE most important behaviour here. Falling back to plaintext would look identical
    from every screen, would never raise an error, and would only be discovered once the
    data had already leaked. A loud failure is a five-minute env fix; silent plaintext
    cannot be un-leaked.
  */
  it('REFUSES to write rather than storing plaintext', () => {
    delete process.env.FIELD_ENCRYPTION_KEY;

    expect(encryptionAvailable()).toBe(false);
    expect(() => encryptField('123456789012')).toThrow(/refusing to store/i);
  });

  it('still passes through empty values without a key', () => {
    delete process.env.FIELD_ENCRYPTION_KEY;
    expect(() => encryptField(null)).not.toThrow();
  });

  it('throws rather than returning ciphertext when asked to decrypt without a key', () => {
    const encrypted = encryptField('123456789012');
    delete process.env.FIELD_ENCRYPTION_KEY;

    expect(() => decryptField(encrypted)).toThrow(/cannot decrypt/i);
  });
});

describe('integrity', () => {
  /*
    GCM is authenticated, so tampering fails loudly. That matters more than usual here:
    the plaintext is an account number somebody is about to send money to, and a silently
    corrupted one would be transferred to a stranger.
  */
  it('refuses a tampered ciphertext instead of returning garbage', () => {
    const encrypted = encryptField('123456789012');
    const parts = encrypted.split(':');
    // Flip a character in the ciphertext segment.
    parts[4] = parts[4][0] === 'A' ? `B${parts[4].slice(1)}` : `A${parts[4].slice(1)}`;

    expect(() => decryptField(parts.join(':'))).toThrow();
  });

  it('refuses a value encrypted under a different key', () => {
    const encrypted = encryptField('123456789012');
    process.env.FIELD_ENCRYPTION_KEY = KEY_B;

    expect(() => decryptField(encrypted)).toThrow();
  });

  it('rejects a key that is not 32 bytes', () => {
    process.env.FIELD_ENCRYPTION_KEY = Buffer.from('too short').toString('base64');
    expect(() => encryptField('x')).toThrow(/32 bytes/);
  });

  it('accepts a hex key as well as base64', () => {
    process.env.FIELD_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
    expect(decryptField(encryptField('ABCDE1234F'))).toBe('ABCDE1234F');
  });
});

describe('legacy plaintext', () => {
  /*
    A collection can be migrated row by row. Reads must work throughout, or the payout
    screen breaks for everyone not yet migrated.
  */
  it('returns an unencrypted stored value as-is', () => {
    expect(decryptField('123456789012')).toBe('123456789012');
    expect(isEncrypted('123456789012')).toBe(false);
  });
});

describe('lastFourOf', () => {
  it('reads through encryption', () => {
    expect(lastFourOf(encryptField('123456789012'))).toBe('9012');
  });

  it('works on a legacy plaintext value too', () => {
    expect(lastFourOf('123456789012')).toBe('9012');
  });
});
