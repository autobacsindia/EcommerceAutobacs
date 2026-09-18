import {
  extractCandidates,
  aggregateCandidates,
  attributeMake,
  stripLeadingMake,
  SKIP_REASONS,
} from '../../../utils/vehicleCandidates.js';

/**
 * These rules decide what becomes a PUBLIC PAGE — scripts/audit-vehicle-candidates.js
 * `--apply` creates a Vehicle row per candidate, and each is a live
 * /vehicles/{make}/{model} URL plus a sitemap entry.
 *
 * The logic shipped with no tests at all and a code review found four defects in
 * it. Every case below is one of those defects or a verbatim label from the live
 * catalogue.
 */

const variable = (name, labels, axis = 'models') => ({
  _id: 'p1',
  name,
  variants: labels.map((label) => ({ label, attributes: [{ name: axis, option: label }] })),
});

describe('extractCandidates — chassis shape must not judge the MODEL position', () => {
  it('keeps i10/i20 as consumer models', () => {
    // THE regression. `looksLikeChassisCode` is letter-then-2-3-digits, which
    // matches Hyundai's consumer names exactly. Applied in the model position it
    // classified them as chassis codes, and the audit silently skipped them —
    // inverting the documented rule that POSITION is the signal.
    const { candidates } = extractCandidates(variable('BMC air filter for Hyundai', ['i10 IRDE 08>', 'i20 ELITE']));
    expect(candidates.every((c) => c.kind === 'consumer-model')).toBe(true);
    expect(candidates.map((c) => c.model)).toEqual(expect.arrayContaining(['i10']));
  });

  it('keeps Volvo-shaped names as consumer models', () => {
    const { candidates } = extractCandidates(variable('Body kit for Volvo', ['S60', 'XC60']));
    expect(candidates.every((c) => c.kind === 'consumer-model')).toBe(true);
  });

  it('still flags codes that appear in the CHASSIS position', () => {
    // After the en-dash is where manufacturers actually put them.
    const { candidates } = extractCandidates(variable('BMC Air Filter for BMW', ['X5 M 4.4L (2019 →) – G05/F95']));
    const kinds = Object.fromEntries(candidates.map((c) => [c.model, c.kind]));
    expect(kinds.X5).toBe('consumer-model');
    expect(kinds.G05).toBe('chassis-code');
    expect(kinds.F95).toBe('chassis-code');
  });
});

describe('attributeMake — refuse to guess rather than invent a car', () => {
  it('prefers a make carried by the label itself', () => {
    expect(attributeMake('Ford Fiesta', 'Universal spoiler').make).toBe('ford');
  });

  it('falls back to the product name when the label is bare', () => {
    expect(attributeMake('CIAZ', 'BMC Air Filter for Maruti Suzuki').make).toBe('maruti');
  });

  it('REFUSES when the product name contains two makes', () => {
    // "Land Rover Defender Style Taillight for Mahindra Thar" is a Mahindra part
    // borrowing a Land Rover look. detectMake returns the LONGEST match, so it
    // confidently answered "land rover" — and under --apply that mints a Vehicle
    // row for a car that does not exist.
    const out = attributeMake('Thar', 'Land Rover Defender Style Taillight for Mahindra Thar');
    expect(out.make).toBeNull();
    expect(out.reason).toBe(SKIP_REASONS.AMBIGUOUS_MAKE);
  });

  it('reports a plain miss distinctly from an ambiguous one', () => {
    expect(attributeMake('WHATEVER', 'Universal LED bar').reason).toBe(SKIP_REASONS.NO_MAKE);
  });
});

describe('extractCandidates — skips are reported, not swallowed', () => {
  it('surfaces the ambiguous-make skip with its reason', () => {
    const { candidates, skipped } = extractCandidates(
      variable('Land Rover Defender Style Taillight for Mahindra Thar', ['Thar'])
    );
    expect(candidates).toHaveLength(0);
    expect(skipped[0].reason).toBe(SKIP_REASONS.AMBIGUOUS_MAKE);
  });

  it('ignores non-vehicle axes entirely', () => {
    // `package` is the most common axis on prod (42 of 111 variable products).
    const { candidates } = extractCandidates(variable('Light bar', ['Red', '22 Inch - Dual Row'], 'color'));
    expect(candidates).toHaveLength(0);
  });

  it('applies the denylist and the correction map', () => {
    const { candidates } = extractCandidates(variable('VW Polo', ['POLO M PI', 'BRV']), {
      denylist: new Set(['polo m pi']),
      corrections: { brv: 'BR-V' },
    });
    expect(candidates.map((c) => c.model)).toEqual(['BR-V']);
  });
});

describe('stripLeadingMake', () => {
  it('prevents "Ford Ford Fiesta"', () => {
    expect(stripLeadingMake('Ford Fiesta', 'ford')).toBe('Fiesta');
  });

  it('leaves a model that merely starts similarly', () => {
    expect(stripLeadingMake('Fiesta', 'ford')).toBe('Fiesta');
  });
});

describe('aggregateCandidates — counts PRODUCTS, not label sightings', () => {
  const c = (model, evidence) => ({ make: 'honda', model, kind: 'consumer-model', evidence });

  it('counts one product once even when several of its labels name the same car', () => {
    // THE defect: productCount incremented per sighting, so a single product whose
    // labels read "CIVIC 06>10" and "CIVIC 13>16" satisfied --min-products=2 alone,
    // defeating the main guard against creating junk public pages.
    const agg = aggregateCandidates([
      { productId: 'p1', productName: 'BMC Honda', candidates: [c('Civic', 'CIVIC 06>10'), c('Civic', 'CIVIC 13>16')] },
    ]);
    expect([...agg.values()][0].productIds.size).toBe(1);
  });

  it('does not duplicate a product name in the evidence samples', () => {
    const agg = aggregateCandidates([
      { productId: 'p1', productName: 'BMC Honda', candidates: [c('Civic', 'a'), c('Civic', 'b')] },
    ]);
    expect([...agg.values()][0].products).toEqual(['BMC Honda']);
  });

  it('counts two distinct products as two', () => {
    const agg = aggregateCandidates([
      { productId: 'p1', productName: 'A', candidates: [c('Civic', 'x')] },
      { productId: 'p2', productName: 'B', candidates: [c('Civic', 'y')] },
    ]);
    expect([...agg.values()][0].productIds.size).toBe(2);
  });

  it('folds punctuation variants of one model together', () => {
    // "BRV" and "BR-V" are one car; separate keys proposed two rows.
    const agg = aggregateCandidates([
      { productId: 'p1', productName: 'A', candidates: [c('BRV', 'x')] },
      { productId: 'p2', productName: 'B', candidates: [c('BR-V', 'y')] },
    ]);
    expect(agg.size).toBe(1);
  });

  it('lets a consumer-model sighting outrank a chassis-code one', () => {
    const agg = aggregateCandidates([
      { productId: 'p1', productName: 'A', candidates: [{ make: 'bmw', model: 'G05', kind: 'chassis-code', evidence: 'x' }] },
      { productId: 'p2', productName: 'B', candidates: [{ make: 'bmw', model: 'G05', kind: 'consumer-model', evidence: 'y' }] },
    ]);
    expect([...agg.values()][0].kind).toBe('consumer-model');
  });
});
