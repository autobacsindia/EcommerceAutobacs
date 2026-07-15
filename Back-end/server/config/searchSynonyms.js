// Search synonym dictionary.
//
// Restores WooCommerce-style recall: a shopper searching a colloquial term (e.g.
// "lights") should match products indexed under related terms ("lighting", "lamp",
// "led", "headlight"...). Seeded from the frontend category patterns
// (Front-end/web/src/lib/categoryMapping.ts) and the backend CATEGORY_MAPPING_RULES.
//
// Used now by the MongoDB search path (services/searchService.js) and intended to
// also feed the Elasticsearch synonym analyzer when ES is enabled (Phase 2).
//
// Groups are bidirectional: any term in a group expands to all terms in that group.
// Keep entries lowercase; matching is case-insensitive.

export const SYNONYM_GROUPS = [
  ['lights', 'light', 'lighting', 'lamp', 'lamps', 'led', 'headlight', 'headlights', 'taillight', 'taillights', 'foglight', 'foglights', 'fog lamp', 'drl', 'ambient light', 'ambient lights'],
  ['audio', 'sound', 'sound system', 'speaker', 'speakers', 'subwoofer', 'sub', 'amplifier', 'amp', 'stereo', 'head unit'],
  // Spelling variants of "body kit" only. bumper / spoiler / splitter / diffuser
  // were previously in this group as mutual synonyms, which meant a search for
  // "spoiler" also returned every bumper (and vice-versa) — they are DISTINCT
  // part types, not synonyms. Recall for each is carried by its own name/category
  // match, not by cross-expanding into the others.
  ['bodykit', 'body kit', 'body kits', 'body-kit'],
  ['suspension', 'shock', 'shocks', 'shock absorber', 'coilover', 'coilovers', 'strut', 'struts', 'lowering spring'],
  ['performance', 'tuning', 'exhaust', 'intake', 'turbo', 'ecu'],
  ['exterior', 'exterior styling', 'trim', 'molding'],
  ['interior', 'cabin', 'dashboard', 'seat cover', 'floor mat', 'floor mats'],
  ['accessories', 'accessory', 'add-on', 'add ons'],
  ['protection kit', 'protection-kit', 'ppf', 'paint protection', 'guard'],
  ['roof top', 'roof-top', 'roof rack', 'roof box', 'roof carrier'],
  ['winch', 'recovery winch'],
  ['portable fridge', 'car fridge', 'cooler'],
];

// Filler words that carry no product intent. Stripped from a query before matching
// so "tailgate spoiler FOR hilux" is treated as [tailgate, spoiler, hilux] and a
// required-terms match isn't distorted by a word almost no product name contains.
// Deliberately conservative — words like "kit"/"set"/"pair" are meaningful in this
// catalog ("body kit") and are NOT stopwords.
export const STOPWORDS = new Set([
  'for', 'the', 'a', 'an', 'and', 'or', 'with', 'of', 'to', 'in', 'on', 'my', 'your', 'me',
]);

/**
 * Reduce a raw query to its content tokens (lowercased, stopwords removed).
 * Never returns an empty list for a non-empty query — if every token is a
 * stopword (e.g. "for the"), the original tokens are kept so the search still runs.
 *
 * @param {string} term - Raw user search term
 * @returns {string[]} Lowercase content tokens
 */
export function contentTokens(term) {
  if (!term || typeof term !== 'string') return [];
  const tokens = term.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const filtered = tokens.filter((t) => !STOPWORDS.has(t));
  return filtered.length ? filtered : tokens;
}

// Build a flat index: term -> Set of all terms in every group that contains it.
const synonymIndex = new Map();
for (const group of SYNONYM_GROUPS) {
  for (const term of group) {
    const key = term.toLowerCase();
    if (!synonymIndex.has(key)) {
      synonymIndex.set(key, new Set());
    }
    const bucket = synonymIndex.get(key);
    group.forEach(t => bucket.add(t.toLowerCase()));
  }
}

/**
 * Expand a search term into itself plus any known synonyms.
 * Matches on the whole trimmed phrase and on each individual word, so multi-word
 * queries like "ambient lights" still pick up the "lights" synonym group.
 * Unknown terms pass through unchanged (always includes the original term).
 *
 * @param {string} term - Raw user search term
 * @returns {string[]} Deduplicated lowercase list of terms to search (original first)
 */
export function expand(term) {
  if (!term || typeof term !== 'string') return [];

  const original = term.trim().toLowerCase();
  if (!original) return [];

  const result = new Set([original]);

  // Whole-phrase match.
  const phraseSynonyms = synonymIndex.get(original);
  if (phraseSynonyms) {
    phraseSynonyms.forEach(s => result.add(s));
  }

  // Per-word match so phrases still trigger relevant groups.
  for (const word of original.split(/\s+/)) {
    const wordSynonyms = synonymIndex.get(word);
    if (wordSynonyms) {
      wordSynonyms.forEach(s => result.add(s));
    }
  }

  return Array.from(result);
}

export default { SYNONYM_GROUPS, expand, STOPWORDS, contentTokens };
