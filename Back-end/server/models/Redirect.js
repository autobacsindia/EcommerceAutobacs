import mongoose from 'mongoose';

/**
 * One old storefront URL and where it goes now — the site's redirect table.
 *
 * Read by GET /redirects/slugs (services/slugRedirectService.js), which the
 * frontend middleware caches and answers from at the edge: `toPath` set → 301,
 * `toPath` null → 410 Gone. Never read per request.
 *
 * Written by:
 *   - admin product delete / deactivate, when the admin picks where the old
 *     product URL should send people (source 'product');
 *   - one-off imports of reviewed legacy maps, e.g. the WordPress /model/<tag>
 *     pages (source 'legacy');
 *   - hand edits (source 'manual').
 *
 * Paths are stored normalised (lib: utils/redirectPaths.js): lowercase, leading
 * slash, no trailing slash, no query. The map endpoint drops any row whose
 * `fromPath` is a live page again, and collapses chains to one hop, so a bad
 * row can neither hide a real page nor make a crawler follow two redirects.
 */
const RedirectSchema = new mongoose.Schema(
  {
    fromPath: { type: String, required: true, trim: true, lowercase: true, maxlength: 300 },
    // null = gone for good (410). A string = permanent redirect target.
    toPath: { type: String, default: null, trim: true, maxlength: 300 },
    source: { type: String, enum: ['product', 'legacy', 'manual'], default: 'manual' },
    note: { type: String, trim: true, maxlength: 300 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

// One row per old URL. Built at startup by config/db.js ensureCriticalIndexes
// (prod runs autoIndex off), declared here so audit-index-drift sees it.
RedirectSchema.index({ fromPath: 1 }, { unique: true, name: 'redirect_from_path' });

export default mongoose.model('Redirect', RedirectSchema);
