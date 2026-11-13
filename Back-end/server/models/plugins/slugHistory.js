/**
 * Remember every slug a document has had, so renaming a URL never breaks it.
 *
 * Without this, changing a product/category/brand/blog slug in admin made the
 * old URL a 404 — every Google ranking, backlink and shared WhatsApp link on it
 * was simply lost. With it, the old slug is kept in `previousSlugs`, served by
 * GET /redirects/slugs, and the frontend middleware answers the old URL with a
 * permanent (301) redirect to the new one.
 *
 * Covers both ways the admin writes a slug:
 *   - `doc.save()` (brands, articles, products): the slug loaded from the DB is
 *     remembered at `init`, compared at `save`.
 *   - `findOneAndUpdate` / `findByIdAndUpdate` / `updateOne` (categories): the
 *     current doc is read first, and `previousSlugs` is set in the same write.
 *
 * Rules, all enforced by `nextPreviousSlugs`:
 *   - Renaming back to an old slug removes it from the list (it is live again,
 *     and a redirect from a URL to itself would loop).
 *   - No duplicates, no empties, and at most MAX_PREVIOUS_SLUGS kept (oldest
 *     dropped) so a slug edited character-by-character can't grow the doc.
 *   - Every old slug points straight at the CURRENT slug: A→B→C stores [A, B],
 *     both redirect to C in one hop, never a chain.
 *
 * `default: undefined` keeps the field off documents that were never renamed —
 * nothing is written to the ~1,400 existing documents.
 */

export const MAX_PREVIOUS_SLUGS = 20;

/**
 * The previous-slug list after a rename from `oldSlug` to `newSlug`.
 * Pure, so the rules are testable without a database.
 */
export function nextPreviousSlugs(existing, oldSlug, newSlug) {
  const list = (Array.isArray(existing) ? existing : []).filter(
    (s) => typeof s === 'string' && s && s !== newSlug && s !== oldSlug,
  );
  if (oldSlug && oldSlug !== newSlug) list.push(oldSlug);
  return list.slice(-MAX_PREVIOUS_SLUGS);
}

/** The slug an update would set, or undefined if it doesn't touch the slug. */
function slugInUpdate(update) {
  if (!update || Array.isArray(update)) return undefined;
  if (update.$set && typeof update.$set.slug === 'string') return update.$set.slug;
  if (typeof update.slug === 'string') return update.slug;
  return undefined;
}

export default function slugHistoryPlugin(schema) {
  schema.add({ previousSlugs: { type: [String], default: undefined } });

  schema.post('init', function rememberLoadedSlug() {
    this.$locals.loadedSlug = this.slug;
  });

  schema.pre('save', function recordRename() {
    if (this.isNew || !this.isModified('slug')) return;
    const oldSlug = this.$locals.loadedSlug;
    if (!oldSlug || oldSlug === this.slug) return;
    this.previousSlugs = nextPreviousSlugs(this.previousSlugs, oldSlug, this.slug);
    this.$locals.loadedSlug = this.slug;
  });

  async function recordRenameOnUpdate() {
    const update = this.getUpdate();
    const raw = slugInUpdate(update);
    if (raw === undefined) return;
    // Match what the schema will store (`lowercase` + `trim` on the slug path).
    const newSlug = raw.trim().toLowerCase();
    if (!newSlug) return; // `required` rejects it; record nothing for a failing write
    const current = await this.model
      .findOne(this.getFilter())
      .select('slug previousSlugs')
      .setOptions({ includeDeleted: true })
      .lean();
    if (!current || !current.slug || current.slug === newSlug) return;
    const previousSlugs = nextPreviousSlugs(current.previousSlugs, current.slug, newSlug);
    if (update.$set) update.$set.previousSlugs = previousSlugs;
    else update.previousSlugs = previousSlugs;
    this.setUpdate(update);
  }

  schema.pre('findOneAndUpdate', recordRenameOnUpdate);
  schema.pre('updateOne', { document: false, query: true }, recordRenameOnUpdate);
}
