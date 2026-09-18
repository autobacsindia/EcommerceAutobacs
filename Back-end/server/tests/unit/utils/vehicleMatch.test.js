import {
  splitCompoundLabel,
  cleanModelLabel,
  looksLikeChassisCode,
  isVehicleAxis,
  detectMake,
  vehicleSlug,
  phraseVariants,
  tokenMatch,
  titleCaseModel,
  MODEL_ALIASES,
  needsMakeConfirmation,
  matchConfidence,
} from '../../../utils/vehicleMatch.js';

/**
 * These rules parse migrated WooCommerce free text, so every fixture below is a
 * VERBATIM label from the live catalogue rather than an invented one. A tidy
 * invented label would pass rules that the real data breaks — which is the whole
 * failure mode this file exists to prevent, since the output feeds a script that
 * creates public /vehicles/{make}/{model} pages.
 */

describe('splitCompoundLabel — one label can name many vehicles', () => {
  it('splits a slash-separated model list', () => {
    const { models, chassis } = splitCompoundLabel('CIAZ/ERTIGA/ BREZZA/S-CROSS/VITARA/WAGON-R III/XL6');
    expect(models).toEqual(['CIAZ', 'ERTIGA', 'BREZZA', 'S-CROSS', 'VITARA', 'WAGON-R III', 'XL6']);
    expect(chassis).toEqual([]);
  });

  it('splits a comma-separated model list', () => {
    const { models } = splitCompoundLabel('Ford Fiesta,Classic,Fusion,Figo,ikon');
    expect(models).toEqual(['Ford Fiesta', 'Classic', 'Fusion', 'Figo', 'ikon']);
  });

  it('separates the chassis suffix BEFORE splitting on slashes', () => {
    // The ordering bug this guards: "/" separates models in the first test and
    // CHASSIS CODES here. Splitting on "/" first yields "G05" and "F95" as model
    // candidates and proposes two junk Vehicle rows.
    const { models, chassis } = splitCompoundLabel('X5 M 4.4L (2019 →) – G05/F95');
    expect(models).toEqual(['X5 M 4.4L (2019 →)']);
    expect(chassis).toEqual(['G05', 'F95']);
  });

  it('does NOT treat a plain hyphen as a chassis separator', () => {
    // "S-CROSS" and "WAGON-R" are model names. Only the en/em dash separates.
    expect(splitCompoundLabel('S-CROSS').models).toEqual(['S-CROSS']);
    expect(splitCompoundLabel('WAGON-R III').chassis).toEqual([]);
  });

  it('returns empty structures for blank input', () => {
    expect(splitCompoundLabel('')).toEqual({ models: [], chassis: [] });
    expect(splitCompoundLabel(null)).toEqual({ models: [], chassis: [] });
  });
});

describe('cleanModelLabel — strip the spec, keep the name', () => {
  it.each([
    ['X5 M 4.4L (2019 →)', 'X5'],
    ['X7 xDrive 40i 3.0L', 'X7 40i'],   // xDrive is a drivetrain badge, not the name
    ['i10 IRDE 08>', 'i10'],
    ['LOGAN', 'LOGAN'],
    ['VERITO 1.5 D', 'VERITO'],
    ['S-CROSS 15>', 'S-CROSS'],
    ['CIVIC 06>10', 'CIVIC'],
    ['A6', 'A6'],
  ])('cleans %s to %s', (input, expected) => {
    expect(cleanModelLabel(input)).toBe(expected);
  });

  it.each([
    ['3.0 TDI V6'],   // engine only
    ['2.0L.'],        // a slash-segment of "C 220 D / C300D, 2.0L."
    [''],
    ['   '],
  ])('rejects %s as spec noise rather than a model', (input) => {
    expect(cleanModelLabel(input)).toBe('');
  });

  it('never returns a single character', () => {
    // "2.0L." reduces to "L" once the displacement is stripped. A one-character
    // candidate would become the Vehicle row "Maruti L" and a public page.
    expect(cleanModelLabel('2.0L.')).toBe('');
    expect(cleanModelLabel('D')).toBe('');
  });
});

/**
 * Regressions from the FIRST dry run against production, which proposed creating
 * "Volkswagen 1 4TSI", "Volkswagen 3 0TD" and "Volkswagen VENTO 0 TSI" as public
 * /vehicles pages. Each is a distinct defect, so each gets its own case.
 */
describe('cleanModelLabel — engine-spec debris from the first prod dry run', () => {
  it('does not let a year range eat the next number (VENTO 0 TSI)', () => {
    // "20> 1.0 TSI": the open-ended range matched "20> 1", leaving ".0 TSI" behind.
    // The closing group now needs two-to-four digits and a boundary.
    expect(cleanModelLabel('VENTO 20> 1.0 TSI')).toBe('VENTO');
  });

  it('strips a displacement with NO space before the engine family (1.4TSI)', () => {
    // There is no word boundary between "4" and "T", so a \b-anchored decimal
    // pattern skipped "1.4TSI" entirely and the dot became a space.
    expect(cleanModelLabel('14>17 1.2TSI')).toBe('');
    expect(cleanModelLabel('1.4TSI')).toBe('');
    expect(cleanModelLabel('3.0TD')).toBe('');
    expect(cleanModelLabel('TOUAREG III 2.0TSI')).toBe('TOUAREG III');
  });

  it('rejects anything not starting with a letter', () => {
    // The catch-all. Slash-splitting "1.2TSI/1.4TSI" yields fragments no pattern
    // fully consumes; a model name always begins with a letter.
    expect(cleanModelLabel('1 4TSI')).toBe('');
    expect(cleanModelLabel('3 0TD')).toBe('');
  });

  it('rejects bare trim/engine acronyms', () => {
    // "POLO GT TSI/ GT TDI 1.2/1.5" split to a lone "GT TDI 1.2" segment.
    expect(cleanModelLabel('GT TDI 1.2')).toBe('');
    expect(cleanModelLabel('TSI')).toBe('');
  });

  it('strips drivetrain badges', () => {
    // "Q5, 2.0 TFSI Quattro" produced the model "Audi Quattro" in the second prod
    // dry run. Quattro is all-wheel drive, not a car.
    expect(cleanModelLabel('2.0 TFSI Quattro')).toBe('');
    expect(cleanModelLabel('Q5, 2.0 TFSI Quattro')).toBe('Q5');
  });

  it("strips Toyota's D-4D engine designation", () => {
    expect(cleanModelLabel('COROLLA ALTIS D-4D 1.4')).toBe('COROLLA ALTIS');
  });

  it('keeps multi-model labels intact end to end', () => {
    const { models } = splitCompoundLabel('TAIGUN / T-ROC 17>/ VIRTUS 1.5 TSI');
    expect(models.map(cleanModelLabel).filter(Boolean)).toEqual(['TAIGUN', 'T-ROC', 'VIRTUS']);
  });
});

describe('looksLikeChassisCode', () => {
  it('recognises manufacturer platform codes', () => {
    for (const code of ['G05', 'F95', 'F10', 'U11', 'W204']) {
      expect(looksLikeChassisCode(code)).toBe(true);
    }
  });

  it('does NOT flag single-digit consumer names', () => {
    // "X5", "Q7" and "A6" are what shoppers type. Flagging them would suppress the
    // exact rows worth creating.
    for (const name of ['X5', 'Q7', 'A6', 'X3']) {
      expect(looksLikeChassisCode(name)).toBe(false);
    }
  });

  it('collides with i10/i20 — which is why POSITION, not shape, is the real signal', () => {
    // Documented, not accidental: Hyundai's consumer names are letter+2-digits,
    // identical in form to a BMW chassis code. The audit only consults this
    // function for a string that appeared AFTER the en-dash in a label, where
    // manufacturers put chassis codes; "i10" never appears there.
    expect(looksLikeChassisCode('i10')).toBe(true);
  });
});

describe('isVehicleAxis — the guard against creating a Vehicle called "Red"', () => {
  it('accepts the vehicle-choice axes', () => {
    expect(isVehicleAxis([{ name: 'models', option: 'X5' }])).toBe(true);
    expect(isVehicleAxis([{ name: 'Vehicle', option: 'Thar' }])).toBe(true);
  });

  it('rejects colour, package and size axes', () => {
    // Measured on prod: `package` is the single most common axis (42 of 111
    // variable products), `color` covers 12. Reading those as vehicles would
    // propose rows for "Red", "22 Inch - Dual Row" and "2 person".
    for (const name of ['color', 'colour', 'package', 'size', 'style', 'title']) {
      expect(isVehicleAxis([{ name, option: 'Red' }])).toBe(false);
    }
  });

  it('rejects malformed or absent attributes', () => {
    expect(isVehicleAxis(undefined)).toBe(false);
    expect(isVehicleAxis([])).toBe(false);
    expect(isVehicleAxis([{}])).toBe(false);
  });
});

describe('detectMake', () => {
  it('resolves an alias to the CANONICAL make', () => {
    // Two spellings must never create two Vehicle rows for one marque.
    expect(detectMake('BMC Air Filter for Maruti Suzuki')).toBe('maruti');
    expect(detectMake('VW Polo body kit')).toBe('volkswagen');
  });

  it('resolves the live "Mercedez" typo', () => {
    // Not hypothetical — "BMC air filter for Mercedez Benz" is a real product name.
    expect(detectMake('BMC air filter for Mercedez Benz')).toBe('mercedes-benz');
  });

  it('finds makes that have NO Vehicle row, which is the point of the audit', () => {
    expect(detectMake('Honda Civic Type R Bodykit')).toBe('honda');
    expect(detectMake('BMC air filter for Mahindra')).toBe('mahindra');
  });

  it('prefers the longest make so multi-word marques are not truncated', () => {
    expect(detectMake('Land Rover Defender snorkel')).toBe('land rover');
  });

  it('returns null when no make is named', () => {
    expect(detectMake('Universal LED Light Bar 22 Inch')).toBeNull();
  });
});

describe('vehicleSlug', () => {
  it('matches the existing bmw-x5 convention', () => {
    expect(vehicleSlug('BMW', 'X5')).toBe('bmw-x5');
    expect(vehicleSlug('Mercedes-Benz', 'G-Class')).toBe('mercedes-benz-g-class');
    expect(vehicleSlug('Maruti', 'WAGON-R III')).toBe('maruti-wagon-r-iii');
  });
});

describe('phraseVariants / tokenMatch — carried over unchanged', () => {
  it('covers hyphen, space and joined spellings', () => {
    expect(phraseVariants('d-max')).toEqual(expect.arrayContaining(['d-max', 'd max', 'dmax']));
  });

  it('matches on whole tokens only', () => {
    expect(tokenMatch('toyota hilux roof rails', 'hilux')).toBe(true);
    // Substring matching would make "x5" hit "x50", turning one model into another.
    expect(tokenMatch('bmw x50 something', 'x5')).toBe(false);
  });
});

describe('titleCaseModel — labels are SHOUTED, rows are user-facing', () => {
  it.each([
    ['AMAZE', 'Amaze'],
    ['COROLLA ALTIS', 'Corolla Altis'],
    ['RANGE ROVER VELAR', 'Range Rover Velar'],
    ['JAZZ', 'Jazz'],
  ])('title-cases the ordinary word %s', (input, expected) => {
    expect(titleCaseModel(input)).toBe(expected);
  });

  it('leaves alphanumeric model codes alone', () => {
    // "i10" must not become "I10" — Hyundai's name is lowercase, and the row is a
    // public page title.
    for (const code of ['A6', 'X5', 'XL6', 'i10', 'i20']) {
      expect(titleCaseModel(code)).toBe(code);
    }
  });

  it('keeps short initialisms uppercase', () => {
    expect(titleCaseModel('CR-V')).toBe('CR-V');   // not "Cr-v"
    expect(titleCaseModel('S-CROSS')).toBe('S-Cross');
  });

  it('keeps roman-numeral generation markers uppercase', () => {
    expect(titleCaseModel('WAGON-R III')).toBe('Wagon-R III'); // not "Iii"
  });

  it('cannot fix a 3-letter initialism, which is why BRV is corrected by hand', () => {
    // "BRV" is indistinguishable from a word to this function. The audit's
    // MODEL_CORRECTIONS maps it to Honda's own "BR-V"; this pins WHY that entry
    // exists so nobody deletes it as redundant.
    expect(titleCaseModel('BRV')).toBe('Brv');
  });
});

describe('MODEL_ALIASES — the BMW 5 Series rename', () => {
  it('maps the chassis codes the catalogue actually writes', () => {
    // The row was "BMW F10" and matched 11 products because their NAMES say F10.
    // Renaming it to the consumer name without these aliases matches nothing.
    expect(MODEL_ALIASES['5 series']).toEqual(expect.arrayContaining(['f10', 'f18', 'g30']));
  });
});

describe('needsMakeConfirmation — the false-fitment guard', () => {
  it('requires the make for model names that are ordinary English words', () => {
    // From the 2026-09-17 prod dry run: matching on the model token alone gave the
    // Honda City 49 products and the Hyundai Accent 10, almost none of which named
    // either car — "ideal for city driving", "adds a sporty accent". One of them
    // was a Mahindra Thar grill.
    for (const word of ['city', 'accent', 'venue', 'classic', 'sport', 'defender']) {
      expect(needsMakeConfirmation(word)).toBe(true);
    }
  });

  it('keeps the pre-existing short-token rule', () => {
    // "X5", "Q7" were already treated this way; the word list extends the same
    // protection rather than replacing it.
    for (const code of ['X5', 'Q7', 'A6', 'MU']) {
      expect(needsMakeConfirmation(code)).toBe(true);
    }
  });

  it('leaves distinctive model names matchable on their own', () => {
    // "Tailgate spoiler for Hilux" never says Toyota. Requiring the make for every
    // model would lose the majority of correct links, so the guard is targeted.
    for (const model of ['hilux', 'fortuner', 'wrangler', 'mustang', 'octavia']) {
      expect(needsMakeConfirmation(model)).toBe(false);
    }
  });

  it('is case- and whitespace-insensitive', () => {
    expect(needsMakeConfirmation('  City  ')).toBe(true);
    expect(needsMakeConfirmation('ACCENT')).toBe(true);
  });
});

/**
 * The fitment backfill's review signal.
 *
 * ⚠️ These tests exist because `medium` SILENTLY BECAME UNREACHABLE once. The inline
 * expression was `makeHit || !ambiguousHit ? 'high' : 'medium'`, and when the caller
 * started dropping `ambiguousHit && !makeHit` outright, that removed the only
 * combination which could score medium. Every match scored `high`,
 * `report.lowConfidence` stayed empty, and the "⚠ N low-confidence match(es)" warning
 * could never fire — so a script that writes PUBLIC vehicle-fitment links lost its only
 * human review gate while every run still looked clean.
 */
describe('matchConfidence', () => {
  it('is high for an unambiguous, non-styling match', () => {
    expect(matchConfidence({ ambiguous: false, styling: false })).toBe('high');
    expect(matchConfidence({})).toBe('high');
    expect(matchConfidence()).toBe('high');
  });

  it('is MEDIUM for a match that only stands because the make appeared', () => {
    // "g30" plus "BMW" somewhere in a long description is far weaker than "5 Series".
    expect(matchConfidence({ ambiguous: true })).toBe('medium');
  });

  it('is MEDIUM for a styling-only match kept as the sole signal', () => {
    // "Defender-style bumper" names a vehicle the part may well not fit.
    expect(matchConfidence({ styling: true })).toBe('medium');
  });

  it('is medium when both signals are present', () => {
    expect(matchConfidence({ ambiguous: true, styling: true })).toBe('medium');
  });

  it('CAN return medium at all — the regression this guards', () => {
    // A tautology only if the implementation is right; the previous one could not
    // produce 'medium' for any input its caller was able to supply.
    const outcomes = new Set([
      matchConfidence({ ambiguous: false, styling: false }),
      matchConfidence({ ambiguous: true, styling: false }),
      matchConfidence({ ambiguous: false, styling: true }),
    ]);
    expect(outcomes).toEqual(new Set(['high', 'medium']));
  });
});
