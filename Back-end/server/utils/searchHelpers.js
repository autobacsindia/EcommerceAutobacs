/**
 * Pure helpers shared by the search layer.
 *
 * Extracted from services/elasticsearchService.js during the Atlas Search
 * migration. They were static/instance members of the Elasticsearch service, so
 * the Atlas adapter had to import the Elasticsearch singleton purely to reach
 * two pure functions — a dependency that made no sense and blocked retiring the
 * old engine. Neither function has anything to do with Elasticsearch.
 */

/**
 * Normalize a product's `images` field into the canonical array shape the
 * frontend/API contract expects: [{ url, alt, isPrimary }]. Accepts the Mongoose
 * array form, a legacy single-string URL, or null/undefined. Returns [] when
 * there is no usable image.
 */
export function normalizeImages(images, productName = '') {
  if (Array.isArray(images)) {
    return images
      .filter((img) => img && (typeof img === 'string' ? img : img.url))
      .map((img) =>
        typeof img === 'string'
          ? { url: img, alt: productName, isPrimary: false }
          : { url: img.url, alt: img.alt || productName, isPrimary: !!img.isPrimary }
      );
  }
  if (typeof images === 'string' && images.trim() !== '') {
    return [{ url: images, alt: productName, isPrimary: true }];
  }
  return [];
}

/**
 * Clamp and clean free-text search input.
 *
 * 1. Length — capped at 200 chars, which comfortably covers real product search
 *    intent while bounding the work a single query can demand.
 * 2. Control characters — null bytes and ASCII control chars (0x00-0x1F, 0x7F)
 *    can break query parsing and produce unpredictable behaviour.
 */
export function sanitizeQuery(input, maxLength = 200) {
  if (typeof input !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').slice(0, maxLength).trim();
}

/**
 * Damerau-Levenshtein edit distance (optimal string alignment), bounded.
 *
 * Damerau, not plain Levenshtein, and that distinction is load-bearing: a
 * TRANSPOSITION is the single most common human typo, and plain Levenshtein scores
 * it as two edits. With the one-edit budget a 5-7 character word gets, "brkae"
 * would score 2 against "brake" and be rejected as too distant — the correction
 * feature would silently fail on exactly the mistakes it exists to catch. Treating
 * an adjacent swap as one edit fixes that.
 *
 * Bounded because the only question asked of it is "is this close enough to be a
 * plausible typo"; anything past `max` is equally useless to the caller, so it
 * returns `max + 1` to mean "further than you care about".
 */
export function editDistance(a, b, max = 3) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;

  // Three rolling rows rather than a full matrix. OSA needs the row from TWO steps
  // back (that is what detects the transposition), so it keeps one more row than a
  // plain Levenshtein would.
  let twoBack = new Array(b.length + 1);
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      // Adjacent transposition: "ab" vs "ba" costs one, not two.
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, twoBack[j - 2] + 1);
      }
      curr[j] = value;
      if (value < rowMin) rowMin = value;
    }
    // Every later row is >= this row's minimum, so once the whole row exceeds the
    // budget the answer cannot come back under it.
    if (rowMin > max) return max + 1;
    [twoBack, prev, curr] = [prev, curr, twoBack];
  }
  return prev[b.length];
}

/**
 * Pick the best "did you mean" correction for a query from candidate text.
 *
 * Kept pure and separate from the Atlas probe that supplies the candidates, so the
 * decision — which is the part with the judgement in it — is unit-testable without
 * a cluster. Atlas Search has no spell suggester of any kind, so a correction has
 * to be derived from what the index actually contains; this is what turns "the top
 * fuzzy hit" into "a word worth suggesting".
 *
 * Rules, in order:
 *  - compare token by token, not whole strings, so one wrong word in a phrase is
 *    correctable ("brkae pads" → "brake");
 *  - a token must be at least MIN_LENGTH characters: correcting 2–3 letter tokens
 *    produces confident nonsense, since almost every short string is one edit from
 *    another;
 *  - the edit distance must be under a length-scaled threshold, so a long word may
 *    absorb two typos while a short one may not;
 *  - an exact match is never "corrected" — if the token already exists in the
 *    catalogue, the query was not misspelled and suggesting otherwise is noise.
 *
 * @param {string} query      the user's (sanitized) query
 * @param {string[]} candidates text from real documents — product names, brands
 * @returns {{original: string, suggested: string, distance: number}|null}
 */
export function pickCorrection(query, candidates) {
  const MIN_LENGTH = 4;
  const queryTokens = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (queryTokens.length === 0) return null;

  const candidateTokens = new Set();
  for (const text of candidates || []) {
    for (const token of String(text || '').toLowerCase().split(/[^a-z0-9]+/)) {
      if (token.length >= MIN_LENGTH) candidateTokens.add(token);
    }
  }
  if (candidateTokens.size === 0) return null;

  let best = null;
  for (const token of queryTokens) {
    if (token.length < MIN_LENGTH) continue;
    // Already a real word in the catalogue — nothing to correct.
    if (candidateTokens.has(token)) continue;

    // Longer words tolerate more typos; 4-7 chars allow one edit, 8+ allow two.
    const budget = token.length >= 8 ? 2 : 1;
    for (const candidate of candidateTokens) {
      const distance = editDistance(token, candidate, budget);
      if (distance > budget) continue;
      if (!best || distance < best.distance) {
        best = { original: token, suggested: candidate, distance };
      }
      if (best.distance === 1) break;
    }
  }

  return best;
}
