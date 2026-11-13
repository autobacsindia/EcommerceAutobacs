/**
 * One-off: point links inside blog posts at the new /blog/<slug> URLs.
 *
 * Blog posts moved from the site root (/<slug>) to /blog/<slug> in 2026-11. The
 * old URLs 301 to the new ones, so nothing is broken — but a link that goes
 * through a redirect wastes a hop for readers and for Google. Audit (2026-11-11)
 * found 4 such links in 3 posts, plus one post whose SEO canonical override still
 * names its own old root URL.
 *
 * What it changes (only blog-type articles are scanned):
 *   - content: href="…" pointing at OUR site (relative, autobacsindia.com or www.)
 *     whose whole path is one blog post's slug → href="/blog/<slug>" (query and
 *     #fragment kept). Nothing else in the HTML is touched — product links, other
 *     dead WordPress paths and other sites stay byte-for-byte.
 *   - seo.canonical: cleared when it is just the post's own old root URL, so the
 *     page canonicalises to itself. (The storefront already treats such an
 *     override as the new URL; this tidies the data.)
 *
 * updatedAt is NOT bumped (timestamps: false): a link fix is not a content edit
 * worth a new sitemap <lastmod>.
 *
 * ── Safety ───────────────────────────────────────────────────────────────────
 *   • DRY-RUN by default: prints every planned change, writes nothing.
 *   • --apply writes, after saving a JSON backup of the original fields of every
 *     changed article. No backup, no write.
 *   • Idempotent — a second run finds nothing to do.
 *   • Connects with { autoIndex: false }, so it never builds indexes.
 *
 * ── Usage ────────────────────────────────────────────────────────────────────
 * Run AFTER the /blog move is deployed and live (code first, then data):
 *   cd Back-end/server
 *   railway run node scripts/rewrite-legacy-blog-links.js            # dry run
 *   railway run node scripts/rewrite-legacy-blog-links.js --apply    # write
 *
 * `railway run` injects the production MONGODB_URI. Do NOT add
 * --import=dotenv/config there: the local .env points at the TEST cluster and
 * would win. To try it against the test cluster instead:
 *   node --import=dotenv/config scripts/rewrite-legacy-blog-links.js
 *
 * Options:  --backup-dir=PATH   (default ./blog-link-backups)
 *
 * ── Rollback ─────────────────────────────────────────────────────────────────
 *   node scripts/rewrite-legacy-blog-links.js --rollback=<backup-file.json> [--apply]
 * restores `content` and `seo.canonical` of each article in the backup to the
 * saved values (dry-run unless --apply).
 *
 * Afterwards: cached copies of these posts expire on their own within minutes
 * (backend article cache 5 min, page cache 60 s); the post-deploy Redis/Cloudflare
 * purge covers it too.
 */

import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import Article from '../models/Article.js';
import { rewriteLegacyBlogLinks, isOwnLegacyCanonical } from '../utils/legacyBlogLinks.js';

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const val = (flag, fallback) => {
  const hit = args.find((a) => a.startsWith(`${flag}=`));
  return hit ? hit.slice(flag.length + 1) : fallback;
};

const APPLY = has('--apply');
const ROLLBACK = val('--rollback', null);
const BACKUP_DIR = val('--backup-dir', path.resolve(process.cwd(), 'blog-link-backups'));

function die(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

async function plan() {
  const articles = await Article.find({ type: 'blog' }).select('_id slug title content seo.canonical').lean();
  const blogSlugs = new Set(articles.map((a) => String(a.slug).toLowerCase()));

  const changes = [];
  for (const a of articles) {
    const { html, changes: links } = rewriteLegacyBlogLinks(a.content, blogSlugs);
    const clearCanonical = isOwnLegacyCanonical(a.seo?.canonical, a.slug);
    if (!links.length && !clearCanonical) continue;
    changes.push({
      _id: a._id,
      slug: a.slug,
      links,
      clearCanonical,
      before: { content: a.content, canonical: a.seo?.canonical ?? null },
      after: { content: html },
    });
  }
  return { scanned: articles.length, changes };
}

async function runRewrite() {
  const { scanned, changes } = await plan();
  console.log(`Scanned ${scanned} blog articles; ${changes.length} need changes.\n`);
  for (const c of changes) {
    console.log(`• ${c.slug}`);
    for (const l of c.links) console.log(`    link  ${l.from}\n       →  ${l.to}`);
    if (c.clearCanonical) console.log(`    canonical override cleared (was ${c.before.canonical})`);
  }
  if (!changes.length) return console.log('Nothing to do.');
  if (!APPLY) return console.log('\nDRY-RUN — nothing written. Re-run with --apply to write.');

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(BACKUP_DIR, `rewrite-legacy-blog-links-${stamp}.json`);
  try {
    fs.writeFileSync(backupFile, JSON.stringify({
      createdAt: new Date().toISOString(),
      db: mongoose.connection.name,
      articles: changes.map((c) => ({ _id: String(c._id), slug: c.slug, ...c.before })),
    }, null, 2));
  } catch (err) {
    die(`could not write the backup to ${backupFile} (${err.message}). Nothing was written.`);
  }
  console.log(`\nBackup written: ${backupFile}`);

  for (const c of changes) {
    const update = { $set: {} };
    if (c.links.length) update.$set.content = c.after.content;
    if (c.clearCanonical) update.$unset = { 'seo.canonical': '' };
    if (!Object.keys(update.$set).length) delete update.$set;
    // Guarded on the content we read, so a concurrent admin edit is never overwritten.
    const res = await Article.updateOne({ _id: c._id, content: c.before.content }, update, { timestamps: false });
    console.log(`  ${res.modifiedCount ? '✓' : '⚠ skipped (changed since read)'}  ${c.slug}`);
  }
  console.log(`\nRollback: node scripts/rewrite-legacy-blog-links.js --rollback=${backupFile} --apply`);
}

async function runRollback(file) {
  let backup;
  try {
    backup = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    die(`cannot read backup ${file}: ${err.message}`);
  }
  const rows = Array.isArray(backup?.articles) ? backup.articles : die('backup has no "articles" array');
  console.log(`Restoring ${rows.length} article(s) from ${file}${APPLY ? '' : ' (DRY-RUN)'}`);
  for (const r of rows) {
    console.log(`• ${r.slug}`);
    if (!APPLY) continue;
    const update = { $set: { content: r.content } };
    if (r.canonical) update.$set['seo.canonical'] = r.canonical;
    const res = await Article.updateOne({ _id: r._id }, update, { timestamps: false });
    console.log(`  ${res.matchedCount ? '✓ restored' : '⚠ not found'}`);
  }
  if (!APPLY) console.log('\nDRY-RUN — nothing written. Re-run with --apply to restore.');
}

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) die('MONGODB_URI (or MONGO_URI) not set in environment.');
  await mongoose.connect(uri, { autoIndex: false });
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(` rewrite-legacy-blog-links   mode=${APPLY ? 'APPLY' : 'DRY-RUN (no writes)'}${ROLLBACK ? '  ROLLBACK' : ''}`);
  console.log(` db=${mongoose.connection.name}   host=${mongoose.connection.host}`);
  console.log('═══════════════════════════════════════════════════════════════\n');
  try {
    if (ROLLBACK) await runRollback(ROLLBACK);
    else await runRewrite();
  } finally {
    await mongoose.connection.close();
  }
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.connection.close().catch(() => {});
  process.exit(1);
});
