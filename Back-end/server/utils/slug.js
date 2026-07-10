/**
 * Slug helpers.
 *
 * `slugify` is the single definition of our URL-slug shape. It was previously
 * copy-pasted across wordpressSyncService, productImageController (brandSlug)
 * and several import scripts; prefer importing from here.
 */

/** Lowercase, collapse every non-alphanumeric run to a single dash, trim dashes. */
export const slugify = (input) =>
  String(input ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/**
 * Find a slug derived from `base` that no other document already holds.
 *
 * Probes `base`, `base-2`, `base-3`, … then gives up and appends a random
 * suffix so a pathological set of collisions can't spin forever.
 *
 * NOTE: this is advisory, not a lock. Two concurrent creates can both observe
 * the same slug as free, and the loser will hit the unique index and surface as
 * a 409 (see errorMiddleware's E11000 mapping). The index stays the source of
 * truth — this only keeps the common case pretty.
 *
 * @param {import('mongoose').Model} Model      model owning the unique `slug`
 * @param {string}                   base       already-slugified base string
 * @param {object}                  [opts]
 * @param {*}                       [opts.excludeId] ignore this _id when probing (updates)
 * @param {number}                  [opts.maxAttempts=50]
 * @returns {Promise<string>}
 */
export async function generateUniqueSlug(Model, base, { excludeId, maxAttempts = 50 } = {}) {
  if (!base) return '';

  const isTaken = async (candidate) => {
    const query = { slug: candidate };
    if (excludeId) query._id = { $ne: excludeId };
    // `includeDeleted` bypasses Product's soft-delete `pre(/^find/)` filter. A
    // soft-deleted doc still occupies its slug in the unique index, so a probe
    // that couldn't see it would happily hand back a slug that then E11000s.
    // The option is inert on models without that hook.
    return Boolean(await Model.exists(query).setOptions({ includeDeleted: true }));
  };

  if (!(await isTaken(base))) return base;

  for (let n = 2; n <= maxAttempts; n += 1) {
    const candidate = `${base}-${n}`;
    if (!(await isTaken(candidate))) return candidate;
  }

  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}
