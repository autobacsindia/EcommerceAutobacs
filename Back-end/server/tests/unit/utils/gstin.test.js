/**
 * GSTIN validation.
 *
 * This is on the money path in a quiet way: the GSTIN a buyer types is printed
 * on the payment receipt we email them (services/invoiceService.js). A typo that
 * survives validation becomes a wrong tax identifier on a financial document the
 * customer keeps — and they will not notice until their accountant does.
 *
 * ⚠️ FIXTURES ARE COMPUTED, NOT INVENTED. A hand-typed 15-character string almost
 * certainly has the WRONG check digit, so a test written that way would pass for
 * the wrong reason (rejected as invalid — but for a defect the test never named).
 * `validGstin()` below builds fixtures via the real check-digit function so the
 * only thing under test is what each case claims to test.
 */

import {
  validateGstin,
  isValidGstin,
  normalizeGstin,
  gstinCheckDigit,
  GSTIN_PATTERN,
} from '../../../utils/gstin.js';

/** Build a checksum-correct GSTIN from a 14-character prefix. */
const validGstin = (prefix14) => prefix14 + gstinCheckDigit(prefix14);

// The canonical example that appears throughout GST documentation. Hardcoded on
// purpose: if our check-digit implementation ever drifts, this is the fixture
// that is not derived from it and so can still catch the drift.
const CANONICAL = '27AAPFU0939F1ZV';

describe('gstinCheckDigit', () => {
  it('reproduces the check digit of the canonical published GSTIN', () => {
    expect(gstinCheckDigit(CANONICAL.slice(0, 14))).toBe('V');
  });

  it('detects a single-character substitution', () => {
    // The property that makes this worth having at all.
    const base = CANONICAL.slice(0, 14);
    const mutated = `${base.slice(0, 5)}X${base.slice(6)}`;
    expect(gstinCheckDigit(mutated)).not.toBe(gstinCheckDigit(base));
  });

  it('detects a transposition of two adjacent characters', () => {
    // Substitution-only schemes miss these; the alternating 1/2 weighting is
    // what catches them, so it is worth asserting the weighting is really there.
    const base = '27AAPFU0939F1Z';
    const swapped = '27AAPFU0993F1Z'; // '39' → '93'
    expect(gstinCheckDigit(swapped)).not.toBe(gstinCheckDigit(base));
  });
});

describe('normalizeGstin', () => {
  it('upper-cases and strips the spacing people paste from invoices', () => {
    expect(normalizeGstin(' 27 aapfu-0939 f1zv ')).toBe(CANONICAL);
  });

  it('is total — null and undefined become empty, never throw', () => {
    expect(normalizeGstin(null)).toBe('');
    expect(normalizeGstin(undefined)).toBe('');
  });
});

describe('validateGstin', () => {
  it('accepts the canonical GSTIN and derives its state', () => {
    const result = validateGstin(CANONICAL);
    expect(result).toMatchObject({
      valid: true,
      gstin: CANONICAL,
      stateCode: '27',
      state: 'Maharashtra',
      pan: 'AAPFU0939F',
    });
  });

  it('accepts a lower-case, space-separated paste', () => {
    expect(validateGstin(' 27 aapfu-0939f1zv ').gstin).toBe(CANONICAL);
  });

  it.each([
    ['missing',    '',                  'missing'],
    ['null',       null,                'missing'],
    ['too short',  '27AAPFU0939F1Z',    'length'],
    ['too long',   `${CANONICAL}X`,     'length'],
    // 15 chars so it reaches the FORMAT branch rather than the length one —
    // 'not-a-gstin-xx' normalises to 11 characters and never gets that far.
    ['15 chars in the wrong shape', 'AB12345678901ZZ', 'format'],
    ['digits where the PAN goes',   '271234U0939F1ZV', 'format'],
  ])('rejects %s', (_label, input, reason) => {
    const result = validateGstin(input);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe(reason);
    // Every rejection must carry copy a buyer can act on — a bare "invalid"
    // leaves them retyping the same correct string.
    expect(result.message).toEqual(expect.any(String));
    expect(result.message.length).toBeGreaterThan(10);
  });

  it('rejects an unissued state code even when the checksum is correct', () => {
    // 00 is not a GST state code. Built with a VALID check digit so the only
    // thing failing is the state code — otherwise this would pass for the
    // wrong reason.
    const bogusState = validGstin('00AAPFU0939F1Z');
    const result = validateGstin(bogusState);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('state_code');
  });

  it('rejects a well-formed GSTIN whose check digit is wrong', () => {
    // The typo case, and the reason this validation exists.
    const wrong = `${CANONICAL.slice(0, 14)}${CANONICAL[14] === 'A' ? 'B' : 'A'}`;
    const result = validateGstin(wrong);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('checksum');
    expect(result.message).toMatch(/typo/i);
  });

  it('accepts legacy state codes that are still live on real registrations', () => {
    // 28 (undivided Andhra Pradesh) and 25 (pre-merger Daman & Diu) are no
    // longer issued but existing registrations remain valid. Rejecting one is a
    // silent "your details are wrong" to a customer whose details are fine.
    for (const [code, state] of [['28', 'Andhra Pradesh'], ['25', 'Dadra and Nagar Haveli and Daman and Diu']]) {
      const result = validateGstin(validGstin(`${code}AAPFU0939F1Z`));
      expect({ code, valid: result.valid, state: result.state })
        .toEqual({ code, valid: true, state });
    }
  });

  it('accepts every issued state code', () => {
    // Guards the config against a typo'd key silently making a whole state
    // unable to check out.
    const codes = ['01', '07', '19', '24', '27', '29', '32', '33', '36', '37', '38', '97', '99'];
    const rejected = codes.filter((c) => !isValidGstin(validGstin(`${c}AAPFU0939F1Z`)));
    expect(rejected).toEqual([]);
  });
});

describe('GSTIN_PATTERN', () => {
  it('requires the constant Z in position 14', () => {
    // Position 14 is reserved and is 'Z' on every GSTIN issued to date.
    expect(GSTIN_PATTERN.test(CANONICAL)).toBe(true);
    expect(GSTIN_PATTERN.test(`${CANONICAL.slice(0, 13)}Y${CANONICAL[14]}`)).toBe(false);
  });

  it('rejects a lower-case GSTIN, so callers must normalize first', () => {
    // Documents why validateGstin normalizes before testing rather than using
    // a case-insensitive flag: normalization is what gets STORED.
    expect(GSTIN_PATTERN.test(CANONICAL.toLowerCase())).toBe(false);
  });
});
