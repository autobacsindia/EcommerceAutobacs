/**
 * buyerService — the gate between a request body and what an order records
 * about who bought and what they agreed to.
 *
 * WHY THESE CASES
 * /terms §17B commits an enterprise buyer to arbitration seated in Ernakulam and
 * to the exclusive jurisdiction of the courts there. §17A leaves a consumer's
 * route to the Consumer Disputes Redressal Commission intact. Which one applies
 * is decided HERE, from a request body. So the failure modes worth testing are
 * not "does it save the field" but:
 *
 *   - can a client talk its way into the enterprise track without a GSTIN?
 *   - can a client choose which terms VERSION it is recorded as accepting?
 *   - can an order exist with no acceptance at all?
 *   - does a malformed buyer type fail towards the weaker waiver, or the stronger?
 *
 * Pure functions, no mocks, no database.
 */

import { resolveBuyer, resolveBuyerAndAcceptance } from '../../../services/buyerService.js';
import { gstinCheckDigit } from '../../../utils/gstin.js';
import { CURRENT_TERMS_VERSION, CURRENT_PRIVACY_VERSION } from '../../../config/legalDocuments.js';

const GSTIN = '27AAPFU0939F1ZV';            // Maharashtra, canonical published example
const KERALA_GSTIN = (() => {
  const prefix = '32AAPFU0939F1Z';
  return prefix + gstinCheckDigit(prefix);
})();

const billingAddress = {
  addressLine1: '12 Marine Drive',
  city: 'Kochi',
  postalCode: '682011',
};

const enterprise = (overrides = {}) => ({
  type: 'enterprise',
  legalName: 'Roavion Motors Private Limited',
  gstin: GSTIN,
  billingAddress,
  ...overrides,
});

describe('resolveBuyer', () => {
  describe('individual', () => {
    it('defaults to individual when no buyer is supplied at all', () => {
      // Every pre-existing order is effectively this. Nothing to backfill.
      expect(resolveBuyer(undefined)).toEqual({ type: 'individual' });
      expect(resolveBuyer(null)).toEqual({ type: 'individual' });
      expect(resolveBuyer({})).toEqual({ type: 'individual' });
    });

    it('DROPS a GSTIN sent alongside type=individual', () => {
      // Storing it would put a tax identifier on the receipt for a sale made on
      // the consumer track — a document saying two contradictory things about
      // which contract governed it.
      const resolved = resolveBuyer({ type: 'individual', gstin: GSTIN, legalName: 'X Ltd' });
      expect(resolved).toEqual({ type: 'individual' });
    });

    it('rejects a buyer type that is neither', () => {
      expect(() => resolveBuyer({ type: 'reseller' })).toThrow(/Buyer type must be one of/);
      expect(() => resolveBuyer({ type: '' })).not.toThrow();          // empty → individual
    });

    it('trims whitespace before matching the type', () => {
      // Asserted via WHICH error it raises: a padded 'enterprise ' must be
      // recognised as the enterprise type (and so fail on its missing legal
      // name), not bounced as an unknown type.
      expect(() => resolveBuyer({ type: ' enterprise ' })).toThrow(/legal name is required/);
    });
  });

  describe('enterprise', () => {
    it('accepts a complete enterprise buyer and derives state from the GSTIN', () => {
      expect(resolveBuyer(enterprise())).toEqual({
        type: 'enterprise',
        legalName: 'Roavion Motors Private Limited',
        gstin: GSTIN,
        stateCode: '27',
        billingAddress: {
          addressLine1: '12 Marine Drive',
          city: 'Kochi',
          state: 'Maharashtra',   // from the GSTIN, NOT from the address
          stateCode: '27',
          postalCode: '682011',
          country: 'India',
        },
      });
    });

    it('IGNORES a client-sent billing state, taking it from the GSTIN instead', () => {
      // GST registration is per state, so the GSTIN already determines which
      // state the bill-to belongs in. A typed state could only ever disagree
      // with it — so it is not read at all, and there is no mismatch to check.
      const resolved = resolveBuyer(
        enterprise({ billingAddress: { ...billingAddress, state: 'Nagaland', stateCode: '13' } })
      );
      expect(resolved.billingAddress.state).toBe('Maharashtra');
      expect(resolved.billingAddress.stateCode).toBe('27');
    });

    it('derives a different state for a GSTIN registered elsewhere', () => {
      const resolved = resolveBuyer(enterprise({ gstin: KERALA_GSTIN }));
      expect(resolved.billingAddress.state).toBe('Kerala');
      expect(resolved.stateCode).toBe('32');
    });

    it('normalizes a pasted GSTIN before storing it', () => {
      expect(resolveBuyer(enterprise({ gstin: ' 27 aapfu-0939f1zv ' })).gstin).toBe(GSTIN);
    });

    it.each([
      ['no GSTIN',            { gstin: '' },                     /GSTIN is required/],
      ['a mistyped GSTIN',    { gstin: '27AAPFU0939F1ZW' },      /check-digit/],
      ['a malformed GSTIN',   { gstin: 'AB12345678901ZZ' },      /valid GSTIN format/],
      ['no legal name',       { legalName: '   ' },              /legal name is required/],
    ])('refuses enterprise with %s', (_label, overrides, expected) => {
      expect(() => resolveBuyer(enterprise(overrides))).toThrow(expected);
    });

    it('refuses an absurdly long legal name', () => {
      expect(() => resolveBuyer(enterprise({ legalName: 'x'.repeat(201) })))
        .toThrow(/200 characters or fewer/);
    });

    it.each([['addressLine1'], ['city'], ['postalCode']])(
      'requires billing %s, because it is printed on the receipt',
      (field) => {
        const address = { ...billingAddress };
        delete address[field];
        expect(() => resolveBuyer(enterprise({ billingAddress: address })))
          .toThrow(/billing/i);
      }
    );

    it('names every missing billing field at once, not one per round-trip', () => {
      expect(() => resolveBuyer(enterprise({ billingAddress: {} })))
        .toThrow(/address, city, postal code/);
    });

    it('rejects a missing billing address entirely', () => {
      expect(() => resolveBuyer(enterprise({ billingAddress: undefined }))).toThrow(/billing/i);
    });
  });

  it('throws 400s that actually reach the buyer', () => {
    // errorMiddleware replaces any message not marked `expose` with "Something
    // went wrong" — which would leave a buyer retyping a GSTIN that was fine.
    try {
      resolveBuyer(enterprise({ gstin: 'nope' }));
      throw new Error('should have thrown');
    } catch (err) {
      expect(err.statusCode).toBe(400);
      expect(err.expose).toBe(true);
    }
  });
});

describe('resolveBuyerAndAcceptance', () => {
  it('records the consumer track for an individual buyer', () => {
    const { buyer, legalAcceptance } = resolveBuyerAndAcceptance({ acceptTerms: true });
    expect(buyer.type).toBe('individual');
    expect(legalAcceptance).toMatchObject({
      track: 'consumer',
      termsVersion: CURRENT_TERMS_VERSION,
      privacyVersion: CURRENT_PRIVACY_VERSION,
    });
  });

  it('records the enterprise track only for a validated enterprise buyer', () => {
    const { legalAcceptance } = resolveBuyerAndAcceptance({
      buyer: enterprise(), acceptTerms: true,
    });
    expect(legalAcceptance.track).toBe('enterprise');
  });

  it('IGNORES a client-supplied terms version', () => {
    // The attack this closes: a client that names its own version chooses which
    // contract binds it.
    const { legalAcceptance } = resolveBuyerAndAcceptance({
      acceptTerms: true,
      legalAcceptance: { termsVersion: '1999-01-01', track: 'consumer' },
      termsVersion: '1999-01-01',
    });
    expect(legalAcceptance.termsVersion).toBe(CURRENT_TERMS_VERSION);
  });

  it('IGNORES a client-supplied track, deriving it from the validated buyer', () => {
    // Otherwise an individual could be recorded as having accepted §17B, or —
    // worse — an enterprise buyer recorded on the consumer track.
    const { legalAcceptance } = resolveBuyerAndAcceptance({
      buyer: { type: 'individual' },
      acceptTerms: true,
      track: 'enterprise',
    });
    expect(legalAcceptance.track).toBe('consumer');
  });

  it.each([
    ['absent',        {}],
    ['false',         { acceptTerms: false }],
    ['the STRING "false"', { acceptTerms: 'false' }],
    ['a truthy non-true', { acceptTerms: 1 }],
    ['null',          { acceptTerms: null }],
  ])('refuses to build an order when acceptance is %s', (_label, body) => {
    // "false" is a truthy string. Accepting it would record consent nobody gave.
    expect(() => resolveBuyerAndAcceptance(body)).toThrow(/must accept the Terms/);
  });

  it('accepts the string "true", because form encodings produce it', () => {
    expect(resolveBuyerAndAcceptance({ acceptTerms: 'true' }).legalAcceptance.track).toBe('consumer');
  });

  it('skips the acceptance gate ONLY when explicitly told to (offline orders)', () => {
    const { legalAcceptance } = resolveBuyerAndAcceptance({}, { requireAcceptance: false });
    expect(legalAcceptance.termsVersion).toBe(CURRENT_TERMS_VERSION);
    expect(legalAcceptance.track).toBe('consumer');
  });

  it('still validates the buyer on an offline order', () => {
    // Waiving the checkbox must not waive the GSTIN — offline is the most
    // likely enterprise path, so this is where a bad GSTIN would slip through.
    expect(() => resolveBuyerAndAcceptance(
      { buyer: enterprise({ gstin: 'bad' }) }, { requireAcceptance: false }
    )).toThrow(/GSTIN/);
  });

  it('carries the hashed IP through and stamps acceptedAt', () => {
    const at = new Date('2026-09-03T10:00:00Z');
    const { legalAcceptance } = resolveBuyerAndAcceptance(
      { acceptTerms: true }, { ipHash: 'deadbeef', acceptedAt: at }
    );
    expect(legalAcceptance).toMatchObject({ ipHash: 'deadbeef', acceptedAt: at });
  });

  it('omits ipHash rather than storing null when the IP is unknown', () => {
    expect(resolveBuyerAndAcceptance({ acceptTerms: true }).legalAcceptance)
      .not.toHaveProperty('ipHash');
  });
});
