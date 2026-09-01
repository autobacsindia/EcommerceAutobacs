/**
 * Careers media retention — delete an applicant's video answers and CV a fixed
 * window after their application was rejected, keeping the application record.
 *
 * The record (name, email, role, decision, admin notes) is retained for audit:
 * if a candidate disputes an outcome you need to know what was decided and by
 * whom. The MEDIA is what is disproportionate to keep — a 30 MB video of
 * someone's face, held indefinitely after they were told no.
 *
 * ── Delete order: Cloudinary FIRST, then clear the refs ─────────────────────
 * The inverse of the product-image flow, on purpose. There, the DB is saved
 * first because the storefront must stop showing the image immediately and a
 * leaked asset is a minor cost.
 *
 * Here the goal IS the bytes being gone, and the two failure modes are not
 * symmetric:
 *   - refs cleared first, then the delete fails → the asset is now referenced
 *     by nothing AND sits in a folder that still maps to an application, so the
 *     abandoned-folder sweep spares it. It becomes a permanent orphan that no
 *     tool will ever find. That is exactly the 1.68 GB leak already cleaned up.
 *   - deleted first, then the save fails → Mongo briefly holds refs to objects
 *     that are gone. The next run re-selects the same application, re-issues the
 *     delete (Cloudinary reports `not_found`, which is treated as success) and
 *     clears the refs. It self-heals.
 * So the crash window costs a retry, never an untrackable orphan.
 *
 * ⚠ Deletion is PERMANENT — Cloudinary backup is not enabled on this account.
 */

/** Default window between rejection and media deletion. */
export const DEFAULT_RETENTION_DAYS = 14;

/** The four upload slots on a careers application. */
export const SLOTS = ['videoOne', 'videoTwo', 'resume', 'support'];

/**
 * The retention clock for an application.
 *
 * Prefers the explicit `rejectedAt` stamp. Falls back to `rejectionEmailedAt`
 * and then `updatedAt` ONLY for applications rejected before `rejectedAt`
 * existed — measured against prod, those two never diverged by more than a day,
 * so the fallback does not materially change any window. Returns null when the
 * application is not rejected at all.
 */
export const retentionClock = (app) => {
  if (!app || app.status !== 'rejected') return null;
  return app.rejectedAt || app.rejectionEmailedAt || app.updatedAt || null;
};

/** Whole days elapsed since `date`. */
export const daysSince = (date, now = Date.now()) =>
  date ? (now - new Date(date).getTime()) / 86400000 : null;

/**
 * Is this application due for media deletion?
 *
 * All four must hold — an application is spared unless every one is true, so a
 * missing field or an unparseable date results in NOT deleting.
 */
export const isDue = (app, { retentionDays = DEFAULT_RETENTION_DAYS, now = Date.now() } = {}) => {
  if (!app || app.status !== 'rejected') return false;
  if (app.mediaPurgedAt) return false;                 // already done
  const clock = retentionClock(app);
  const age = daysSince(clock, now);
  if (age === null || Number.isNaN(age)) return false; // undeterminable → keep
  if (age <= retentionDays) return false;
  return filesOf(app).length > 0;                      // nothing to delete
};

/** The populated file slots on an application. */
export const filesOf = (app) =>
  SLOTS
    .map((slot) => ({ slot, ...(app?.files?.[slot] || {}) }))
    .filter((f) => f.publicId);

/**
 * Select every application due for media deletion.
 * Pure over the input list, so the selection rule is testable without a DB.
 */
export const selectDue = (apps, opts = {}) => apps.filter((a) => isDue(a, opts));

/**
 * Purge one application's media.
 *
 * @param {object} app                    a lean JobApplication
 * @param {object} deps
 * @param {Function} deps.deleteAsset     ({publicId, resourceType}) => Promise<boolean>
 * @param {Function} deps.persist         (appId, patch) => Promise<void>
 * @param {boolean}  deps.apply           false = dry run
 * @returns {Promise<{applicationId, deleted, failed, bytes, files, status}>}
 */
export const purgeApplicationMedia = async (app, { deleteAsset, persist, apply }) => {
  const files = filesOf(app);
  const bytes = files.reduce((s, f) => s + (f.bytes || 0), 0);
  const base = {
    applicationId: String(app._id),
    applicant: app.fullName,
    email: app.email,
    files: files.map((f) => ({ slot: f.slot, publicId: f.publicId, bytes: f.bytes || 0 })),
    bytes,
  };

  if (!apply) return { ...base, status: 'would-purge', deleted: 0, failed: [] };

  // 1. Storage first (see header).
  let deleted = 0;
  const failed = [];
  for (const f of files) {
    const ok = await deleteAsset({ publicId: f.publicId, resourceType: f.resourceType || 'image' });
    if (ok) deleted += 1; else failed.push(f.publicId);
  }

  /*
    2. Only clear the refs once every asset is gone. A partial clear would drop
       the pointer to whatever survived, and that survivor is unreachable
       afterwards — the application still owns its folder, so the abandoned
       sweep will not claim it either. Leaving the refs intact means the next
       run retries the whole set.
  */
  if (failed.length) return { ...base, status: 'partial', deleted, failed };

  await persist(app._id, {
    files: { videoOne: {}, videoTwo: {}, resume: {}, support: {} },
    mediaPurgedAt: new Date(),
  });

  return { ...base, status: 'purged', deleted, failed: [] };
};

/** Aggregate purge rows for reporting. */
export const summarise = (rows) => {
  const out = { purged: 0, wouldPurge: 0, partial: 0, files: 0, bytes: 0 };
  rows.forEach((r) => {
    if (r.status === 'purged') { out.purged++; out.files += r.deleted; out.bytes += r.bytes; }
    else if (r.status === 'would-purge') { out.wouldPurge++; out.files += r.files.length; out.bytes += r.bytes; }
    else if (r.status === 'partial') out.partial++;
  });
  return out;
};

export default {
  DEFAULT_RETENTION_DAYS, SLOTS, retentionClock, daysSince,
  isDue, filesOf, selectDue, purgeApplicationMedia, summarise,
};
