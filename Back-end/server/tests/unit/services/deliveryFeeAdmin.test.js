/**
 * Admin input for the delivery-fee rate card and the remote-PIN list.
 * A blank or absurd rate must be refused, never stored as 0 (under-quote) or huge (overcharge).
 */
import {
  parseRateCardInput, parsePinList, toRateCard, normalizePin, RATE_CARD_FIELDS, MAX_REMOTE_PINS_PER_UPLOAD,
} from '../../../services/deliveryFeeService.js';
import { DEFAULT_RATE_CARD } from '../../../utils/deliveryFees.js';

const full = () => JSON.parse(JSON.stringify(DEFAULT_RATE_CARD));

describe('parseRateCardInput', () => {
  it('accepts the default card and returns every numeric field', () => {
    const set = parseRateCardInput(full(), toRateCard(null));
    for (const f of RATE_CARD_FIELDS) expect(typeof set[f]).toBe('number');
    expect(set['freight.minimum']).toBe(500);
    expect(set.distanceBands).toHaveLength(5);
    expect(set.distanceBands[4]).toEqual({ upToKm: null, ratePerKg: 16, slabRate: null });
  });

  it('accepts numbers typed as strings (form inputs)', () => {
    const raw = full();
    raw.freight.hamaliPerKg = '0.45';
    expect(parseRateCardInput(raw, toRateCard(null))['freight.hamaliPerKg']).toBe(0.45);
  });

  it.each([
    ['blank', ''],
    ['missing', undefined],
    ['negative', -1],
    ['too large', 99999],
    ['text', 'abc'],
  ])('refuses a %s rate instead of storing 0', (_n, v) => {
    const raw = full();
    raw.freight.minimum = v;
    expect(() => parseRateCardInput(raw, toRateCard(null))).toThrow(/freight.minimum/);
  });

  it('booleans keep their current value when not sent', () => {
    const raw = full();
    delete raw.chargeAtCheckout;
    expect(parseRateCardInput(raw, { ...toRateCard(null), chargeAtCheckout: true }).chargeAtCheckout).toBe(true);
  });
});

describe('distance bands + origin', () => {
  const withBands = (bands) => ({ ...full(), distanceBands: bands });
  it('accepts ascending bands ending open-ended; the last band\'s km is ignored', () => {
    const set = parseRateCardInput(withBands([{ upToKm: '800', ratePerKg: '14' }, { upToKm: 99, ratePerKg: 18 }]), toRateCard(null));
    expect(set.distanceBands).toEqual([{ upToKm: 800, ratePerKg: 14, slabRate: null }, { upToKm: null, ratePerKg: 18, slabRate: null }]);
  });
  it('takes an optional small-parcel slab rate per band; blank = all-India rate', () => {
    const set = parseRateCardInput(withBands([{ upToKm: 800, ratePerKg: 14, slabRate: '60' }, { upToKm: null, ratePerKg: 18, slabRate: '' }]), toRateCard(null));
    expect(set.distanceBands).toEqual([{ upToKm: 800, ratePerKg: 14, slabRate: 60 }, { upToKm: null, ratePerKg: 18, slabRate: null }]);
    expect(toRateCard({ distanceBands: set.distanceBands }).distanceBands[0].slabRate).toBe(60);
  });
  it.each([
    ['empty', []],
    ['km going down', [{ upToKm: 1000, ratePerKg: 16 }, { upToKm: 500, ratePerKg: 16 }, { upToKm: null, ratePerKg: 16 }]],
    ['blank rate', [{ upToKm: 500, ratePerKg: '' }, { upToKm: null, ratePerKg: 16 }]],
    ['blank km', [{ upToKm: '', ratePerKg: 16 }, { upToKm: null, ratePerKg: 16 }]],
    ['bad slab rate', [{ upToKm: 500, ratePerKg: 16, slabRate: 'abc' }, { upToKm: null, ratePerKg: 16 }]],
    ['negative slab rate', [{ upToKm: 500, ratePerKg: 16, slabRate: -5 }, { upToKm: null, ratePerKg: 16 }]],
    ['too many', Array.from({ length: 11 }, (_, i) => ({ upToKm: (i + 1) * 100, ratePerKg: 16 }))],
  ])('refuses %s bands', (_n, bands) => {
    expect(() => parseRateCardInput(withBands(bands), toRateCard(null))).toThrow(/Distance bands/);
  });
  it('refuses a bad origin PIN or a location outside India', () => {
    expect(() => parseRateCardInput({ ...full(), origin: { ...full().origin, pin: '12' } }, toRateCard(null))).toThrow(/origin.pin/);
    expect(() => parseRateCardInput({ ...full(), origin: { ...full().origin, lat: 51.5 } }, toRateCard(null))).toThrow(/origin.lat/);
  });
  it('a malformed stored band list falls back to the defaults (never misprices)', () => {
    expect(toRateCard({ distanceBands: [{ upToKm: 500, ratePerKg: 16 }] }).distanceBands).toEqual(DEFAULT_RATE_CARD.distanceBands.map((b) => ({ ...b, slabRate: null })));
  });
});

describe('toRateCard', () => {
  it('fills every gap of a partial stored doc with defaults', () => {
    const card = toRateCard({ freight: { minimum: 600 } });
    expect(card.freight.minimum).toBe(600);
    expect(card.freight.docket).toBe(DEFAULT_RATE_CARD.freight.docket);
    expect(card.origin).toEqual({ ...DEFAULT_RATE_CARD.origin });
    expect(card.chargeAtCheckout).toBe(false);
  });
});

describe('PIN parsing', () => {
  it('pulls 6-digit PINs out of pasted CSV, deduped; ignores longer numbers', () => {
    expect(parsePinList('735101, 735102\n735101;phone 9876543210 x 012345')).toEqual(['735101', '735102']);
  });
  it('caps one upload', () => {
    const many = Array.from({ length: MAX_REMOTE_PINS_PER_UPLOAD + 1 }, (_, i) => String(100000 + i)).join(',');
    expect(() => parsePinList(many)).toThrow(/At most/);
  });
  it('normalizePin', () => {
    expect(normalizePin(' 735 101 ')).toBe('735101');
    expect(normalizePin('12')).toBeNull();
    expect(normalizePin(null)).toBeNull();
  });
});
