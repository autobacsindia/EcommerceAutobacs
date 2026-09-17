/**
 * Pure helpers for matching free text against vehicle make/model names.
 *
 * Extracted from scripts/backfill-vehicle-fitment.js on 2026-09-17 so that script
 * and scripts/audit-vehicle-candidates.js share ONE set of rules. They answer two
 * halves of the same question — "which known vehicle does this product fit?" and
 * "which vehicle does this product name that we have no row for?" — and if their
 * spelling rules drift, the audit recommends creating a row the backfill will then
 * fail to match, which is the most confusing possible outcome.
 *
 * Everything here is pure and side-effect free, so the parsing rules are testable
 * without a database. That matters more than usual: the labels these functions
 * chew on are migrated WooCommerce free text, and the rules are heuristics.
 */

/**
 * Extra text spellings, keyed by the normalized model name from the DB.
 * Matched IN ADDITION to the literal make/model strings.
 */
export const MODEL_ALIASES = {
  'd-max': ['dmax', 'v-cross', 'vcross'], // V-Cross is a D-Max trim sold in India
  'thar': ['thar roxx'],
  'g-class': ['g-wagon', 'gwagon', 'g-wagen'],
  'scorpio n': ['scorpio'],   // catalog also says bare "Scorpio" (mostly the N)
  'xuv700': ['xuv 700'],      // branded "XUV700" but written "XUV 700" in products
  'xuv300': ['xuv 300'],
  // The 5 Series row replaced a hand-made "BMW F10" row on 2026-09-17. The rename
  // alone would have BROKEN fitment: the 11 products it matched say "F10" in their
  // NAMES ("Bmw F10 Steering Wheel") and none says "5 Series", so a row renamed
  // without these aliases silently matches nothing. Chassis codes belong in the
  // alias list — searchable, but not a filter entry a shopper has to decode.
  '5 series': ['f10', 'f11', 'f18', 'g30', 'g38', 'f90'],
};

/** Extra spellings for makes (used to confirm short/ambiguous model tokens). */
export const MAKE_ALIASES = {
  'maruti': ['suzuki', 'maruti suzuki'],
  'mercedes-benz': ['mercedes', 'benz', 'mercedez'], // "Mercedez" is a live catalogue typo
  'volkswagen': ['vw'],
  'land rover': ['landrover'],
};

/**
 * Makes to look for when DISCOVERING candidates, as opposed to matching known ones.
 *
 * The backfill derives every phrase from the Vehicle collection, which is correct
 * for its job and useless for this one: a make with ZERO rows is exactly what the
 * audit needs to find. The live catalogue sells parts for Honda, Renault and Nissan
 * and the Vehicle collection has never heard of them, so their models can never be
 * discovered by reading that collection back.
 *
 * Kept deliberately short and India-market. A long list of global marques would
 * mostly add false positives from model names that happen to be English words.
 */
export const KNOWN_MAKES = [
  'audi', 'bmw', 'chevrolet', 'citroen', 'datsun', 'fiat', 'force', 'ford',
  'honda', 'hyundai', 'isuzu', 'jeep', 'kia', 'land rover', 'lexus', 'mahindra',
  'maruti', 'mercedes-benz', 'mg', 'mitsubishi', 'nissan', 'porsche', 'renault',
  'skoda', 'tata', 'toyota', 'volkswagen', 'volvo',
];

/**
 * `variants.attributes.name` values that mean "this dropdown picks a VEHICLE".
 *
 * Measured across the 111 live variable products, the axis is `package` on 42,
 * `models` on 23, `color` on 12, `style` on 7 and a long tail below that. Only the
 * names below are fitment; the rest pick a size, a colour or a kit. Reading a
 * colour axis as vehicles is what would propose creating a Vehicle called "Red".
 */
export const VEHICLE_AXIS_NAMES = ['models', 'model', 'vehicle', 'vehicles', 'car', 'cars'];

/** Does this variant's attribute set describe a vehicle choice? */
export function isVehicleAxis(attributes) {
  if (!Array.isArray(attributes)) return false;
  return attributes.some((a) =>
    VEHICLE_AXIS_NAMES.includes(String(a?.name || '').toLowerCase().trim()));
}

/** Build bounded match variants for a phrase: handles hyphen/space/joined forms. */
export function phraseVariants(phrase) {
  const base = String(phrase).toLowerCase().trim();
  if (!base) return [];
  const set = new Set([base]);
  set.add(base.replace(/-/g, ' '));
  set.add(base.replace(/-/g, ''));
  set.add(base.replace(/\s+/g, ''));
  set.add(base.replace(/\s+/g, '-'));
  return [...set].filter(Boolean);
}

export function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True if `variant` appears in `text` as a whole token (alphanumeric-bounded). */
export function tokenMatch(text, variant) {
  const re = new RegExp('(^|[^a-z0-9])' + escapeRegex(variant) + '([^a-z0-9]|$)', 'i');
  return re.test(text);
}

// A model name used as a STYLING reference rather than fitment, e.g.
// "Defender Style Taillight for Thar", "Defender V1 style spoiler".
const STYLING_WORDS = '(?:style|styled|styling|look|inspired)';
export function stylingMatch(text, variant) {
  // Allow only an optional version token (v1, v.2, v3) between the model and the
  // styling word. A broader gap would wrongly span adjacent models — e.g.
  // "Thar Roxx Defender style" must NOT flag "Thar" as a styling reference.
  const re = new RegExp(
    '(^|[^a-z0-9])' + escapeRegex(variant) + '[\\s-]+(?:v\\.?\\d+[\\s-]+)?' + STYLING_WORDS + '\\b',
    'i'
  );
  return re.test(text);
}

/**
 * Chassis/platform codes carry a manufacturer's internal designation (BMW G05,
 * F10; Mercedes W204; Hyundai U11) rather than the name a shopper knows.
 *
 * They matter because each Vehicle row becomes a public page at
 * /vehicles/{make}/{model} plus a sitemap entry, and "BMW F10" sitting in a filter
 * beside "Toyota Fortuner" is both confusing to shoppers and a thin page for
 * Google. The audit flags them so creating one has to be a deliberate choice.
 *
 * ⚠ Pattern alone CANNOT decide this, and pretending otherwise would be wrong in
 * both directions: "X5" and "Q7" are consumer names shaped exactly like codes,
 * while Hyundai's "i10"/"i20" are letter+2-digits — identical in form to "F10".
 * So the pattern is only consulted for a string that ALSO appeared in the chassis
 * POSITION of a label (after the en-dash in "X5 M 4.4L (2019 →) – G05/F95"), which
 * is where manufacturers actually put them. Position is the real signal; shape
 * only confirms it.
 */
export function looksLikeChassisCode(value) {
  return /^[a-z]{1,2}\d{2,3}$/i.test(String(value || '').trim());
}

// Year/period markers: "(2019 →)", "08>", "06>10", "2018 onwards", "15>".
//
// ⚠ The open-ended form deliberately has NO trailing \b. "08>" ends the string
// after a non-word character, so `\d{0,4}\b` cannot match there — the boundary
// needs a word character on one side — and the whole pattern would backtrack and
// leave "08>" in the name. Hyphen is excluded from the separator class for the
// same class of reason: "WAGON-R III" and "S-CROSS" are model names, not ranges.
const YEAR_PATTERNS = [
  // ALL parentheticals, not just year-bearing ones. In these labels a bracket only
  // ever holds a year, a displacement or a chassis code: "RANGE ROVER VELAR (L560)
  // 2.0" produced the model "RANGE ROVER VELAR L560" when only years were stripped.
  /\([^)]*\)/g,
  // ⚠ The closing group requires TWO-to-four digits and a boundary. With `\d{0,4}`
  // it greedily ate the leading digit of whatever followed: "VENTO 20> 1.0 TSI"
  // consumed "20> 1" and produced the model "VENTO 0 TSI".
  /\b\d{2,4}\s*[>→]\s*(?:\d{2,4}\b)?/g,    // 08>, 06>10, 2017→
  /\b(?:19|20)\d{2}\s*\+?/g,               // 2019, 2019+
  /\bonwards?\b/gi,
];

// Engine families that attach directly to a displacement with no space.
// Ordered LONGEST-FIRST: the alternation is tried left to right, so a bare "tsi"
// listed before "tfsi" would match the tail of "TFSI" and leave a stray "F".
const ENGINE_FAMILY = 'multijet|tdci|tfsi|crdi|vtec|mpfi|irde|tsi|tdi|dsg|vrs|td|dci|di';

// Engine/trim noise that is never the model name on its own.
const ENGINE_PATTERNS = [
  // Displacement + OPTIONALLY-ATTACHED family, in one pass. Written without a
  // trailing \b because "1.4TSI" has no boundary between "4" and "T" — digits and
  // letters are both word characters — so a \b-anchored decimal pattern skipped it
  // entirely and left the candidate "1 4TSI" once the dot became a space.
  new RegExp(`\\b\\d+(?:\\.\\d+)?\\s*(?:${ENGINE_FAMILY}|l)\\b`, 'gi'),
  new RegExp(`\\b\\d+\\.\\d+\\s*(?:${ENGINE_FAMILY})?`, 'gi'),
  /\bd-?4d\b/gi,                            // Toyota's D-4D diesel
  // Drivetrain badges. "Q5, 2.0 TFSI Quattro" otherwise yields the model
  // "Quattro", and "X7 xDrive 40i" keeps a badge that is not part of the name.
  /\b(?:quattro|4matic|xdrive|sdrive|allgrip|awd|4wd|fwd|rwd|4x4)\b/gi,
  new RegExp(`\\b(?:${ENGINE_FAMILY})\\b`, 'gi'),
  /\bv\d\b/gi,                              // V6, V8
];

/**
 * Cleaned segments that are engine/trim debris rather than a vehicle.
 *
 * These survive the pattern passes because they are bare words, but no shopper
 * filters by "GT" — and a Vehicle row called "Volkswagen GT" would be a public
 * page for something that is not a car.
 */
const NON_MODEL_TOKENS = new Set(['gt', 'gti', 'tsi', 'tdi', 'td', 'di', 'l', 'p', 'd', 'quattro', 'xdrive']);

/**
 * Split a compound variant label into individual model references.
 *
 * Real labels from the live catalogue:
 *   "CIAZ/ERTIGA/ BREZZA/S-CROSS/VITARA/WAGON-R III/XL6"  → 7 models
 *   "Ford Fiesta,Classic,Fusion,Figo,ikon"                → 5 models
 *   "X5 M 4.4L (2019 →) – G05/F95"                        → 1 model + chassis
 *
 * ⚠ The en-dash split MUST happen before the slash split. "/" separates models in
 * the first example and CHASSIS CODES in the third, and the only thing telling them
 * apart is that chassis codes sit after the "–". Splitting on "/" first turns
 * "G05/F95" into two model candidates and proposes two junk Vehicle rows.
 *
 * @returns {{models: string[], chassis: string[]}} raw (uncleaned) segments
 */
export function splitCompoundLabel(label) {
  const raw = String(label || '').trim();
  if (!raw) return { models: [], chassis: [] };

  // En-dash / em-dash separates the shopper-facing name from the chassis suffix.
  // A plain hyphen does NOT: "S-CROSS" and "WAGON-R" are model names.
  const [head, ...tail] = raw.split(/\s[–—]\s|[–—]/);
  const chassis = tail
    .join(' ')
    .split(/[/,]/)
    .map((s) => s.trim())
    .filter(Boolean);

  const models = String(head || '')
    .split(/[/,]/)
    .map((s) => s.trim())
    .filter(Boolean);

  return { models, chassis };
}

/**
 * Strip year ranges, engine specs and punctuation from one label segment, leaving
 * the model name a person would recognise.
 *
 *   "X5 M 4.4L (2019 →)"  → "X5"
 *   "i10 IRDE 08>"        → "i10"
 *   "VERITO 1.5 D"        → "VERITO"
 *   "3.0 TDI V6"          → ""        (engine only — not a model)
 *   "2.0L."               → ""        (a slash-segment of "C 220 D / C300D, 2.0L.")
 *
 * @returns {string} cleaned model name, or '' when nothing recognisable remains
 */
export function cleanModelLabel(segment) {
  let s = String(segment || '');
  for (const re of YEAR_PATTERNS) s = s.replace(re, ' ');
  for (const re of ENGINE_PATTERNS) s = s.replace(re, ' ');
  s = s
    .replace(/[()[\]{}]/g, ' ')
    .replace(/[.,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // A trailing BARE letter is a fuel/trim marker, not part of the name the shopper
  // knows: "VERITO 1.5 D" → "VERITO", "X5 M" → "X5". Creating "BMW X5 M" alongside
  // "BMW X5" would split one model's products across two filter entries.
  s = s.replace(/\s+[a-z]$/i, '').trim();

  // Nothing but digits/punctuation left means the segment was spec noise.
  if (!/[a-z]/i.test(s)) return '';
  // A single surviving character is always debris — "2.0L." reduces to "L" once the
  // displacement is stripped, and "L" is not a car.
  if (s.length < 2) return '';

  // A model name STARTS with a letter. This is the catch-all for engine-spec
  // residue that survives the patterns: a slash-split of "1.2TSI/1.4TSI" yields
  // fragments that clean to "1 4TSI", which is not a vehicle and would otherwise
  // have become the public page /vehicles/volkswagen/1-4tsi.
  if (!/^[a-z]/i.test(s)) return '';

  // Bare trim/engine acronyms ("GT", "TSI") are not models on their own.
  if (NON_MODEL_TOKENS.has(s.toLowerCase())) return '';

  return s;
}

/** URL slug for a vehicle row, matching the existing `bmw-x5` convention. */
export function vehicleSlug(make, model) {
  return `${make} ${model}`
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Find which known make a piece of text names.
 *
 * Aliases are checked alongside the canonical spelling so "Mercedez" (a typo that
 * is live in the catalogue today) and "VW" both resolve. Returns the CANONICAL
 * make so two spellings can never create two Vehicle rows for one marque.
 *
 * @returns {string|null} canonical make, or null when the text names none
 */
export function detectMake(text, makes = KNOWN_MAKES) {
  const haystack = String(text || '').toLowerCase();
  // Longest first, so "land rover" wins over a bare "rover"-like substring and
  // "maruti suzuki" is not split across two makes.
  const ordered = [...makes].sort((a, b) => b.length - a.length);
  for (const make of ordered) {
    const spellings = [make, ...(MAKE_ALIASES[make] || [])];
    for (const spelling of spellings) {
      if (phraseVariants(spelling).some((v) => tokenMatch(haystack, v))) return make;
    }
  }
  return null;
}

/**
 * Display spelling for a canonical make.
 *
 * `KNOWN_MAKES` is lowercase because matching is case-insensitive, but a created
 * Vehicle row is USER-FACING — it becomes a filter entry and a public page title.
 * Naive title-casing produces "Bmw" and "Mg", so the irregular ones are listed.
 * Callers should prefer the spelling already used by the live Vehicle collection
 * and fall back to this, so a new row can never disagree with an existing one.
 */
export const MAKE_DISPLAY = {
  bmw: 'BMW', mg: 'MG', 'mercedes-benz': 'Mercedes-Benz', 'land rover': 'Land Rover',
  volkswagen: 'Volkswagen', skoda: 'Skoda', citroen: 'Citroen', maruti: 'Maruti',
};

/** Title-case a canonical make for display, honouring the irregular spellings. */
export function makeDisplayName(make) {
  const key = String(make || '').toLowerCase().trim();
  if (MAKE_DISPLAY[key]) return MAKE_DISPLAY[key];
  return key.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/**
 * Roman-numeral generation markers ("Octavia III", "Wagon-R III"). Listed because
 * title-casing would render them "Iii".
 */
const ROMAN_NUMERALS = new Set(['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x']);

/**
 * Present a SHOUTED label as a model name a shopper would recognise.
 *
 * Variant labels are migrated in upper case ("AMAZE", "COROLLA ALTIS"), but a
 * Vehicle row is user-facing — it is a filter entry and a public page title — and
 * "Honda AMAZE" beside the existing "Toyota Fortuner" reads as broken data.
 *
 * ⚠ Naive title-casing is wrong for most of this catalogue's names. Three classes
 * have to survive untouched, and each is a real model here:
 *   • alphanumeric codes — "A6", "X5", "XL6", "i10" (NOT "I10")
 *   • short initialisms  — "CR-V", "BR-V", "MU" (NOT "Cr-v")
 *   • roman numerals     — "III" (NOT "Iii")
 */
export function titleCaseModel(model) {
  return String(model || '')
    .trim()
    .split(/(\s+|-)/)                       // keep separators so hyphens survive
    .map((part) => {
      if (/^(\s+|-)$/.test(part) || !part) return part;
      // Anything carrying a digit is a code: keep the source casing exactly.
      if (/\d/.test(part)) return part;
      if (ROMAN_NUMERALS.has(part.toLowerCase())) return part.toUpperCase();
      // One- and two-letter tokens are initialisms ("CR", "V", "MU"), not words.
      if (part.length <= 2) return part.toUpperCase();
      return part[0].toUpperCase() + part.slice(1).toLowerCase();
    })
    .join('');
}

/**
 * Model names that are also ordinary English words.
 *
 * These CANNOT be matched on the model token alone — the make has to appear too.
 * Found by reviewing the 2026-09-17 production dry run, which proposed 49 products
 * for the Honda City and 10 for the Hyundai Accent. Almost none named either car:
 * they were descriptions saying "ideal for city driving", "city traffic",
 * "red and silver accent options", "adds a sporty accent". It would have recorded
 * a Mahindra Thar grill as fitting a Honda City.
 *
 * This is the same rule the index already applies to very short model tokens
 * ("X5", "Q7"), for the same reason and with the same remedy — an ambiguous token
 * needs corroboration. The trade is deliberate: a product named "City Body Kit"
 * with no "Honda" anywhere is now missed. On a fitment field a false POSITIVE
 * tells a shopper a part fits their car when it does not, so a miss is the far
 * cheaper error.
 */
export const AMBIGUOUS_MODEL_WORDS = new Set([
  'city', 'accent', 'venue', 'classic', 'sport', 'fusion', 'rapid', 'sunny',
  'compass', 'meridian', 'defender', 'ranger', 'endeavour', 'freestyle',
  'elevate', 'jazz', 'brio', 'eon', 'figo', 'scala', 'virtus', 'camry',
]);

/** Does this model name need the make alongside it before a match is trusted? */
export function needsMakeConfirmation(model) {
  const key = String(model || '').toLowerCase().trim();
  // Very short tokens ("X5", "Q7") were already treated this way; the word list
  // extends the same protection to ordinary-English model names.
  if (key.replace(/[^a-z0-9]/g, '').length <= 3) return true;
  return AMBIGUOUS_MODEL_WORDS.has(key);
}
