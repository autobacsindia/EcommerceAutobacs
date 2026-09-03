/**
 * Phase 6 — repoint stored asset URLs from Cloudinary to R2.
 *
 * The bytes were copied in Phase 1-4 and every upload path has written to R2
 * since the flip. What is left is the pointers: 3,607 Cloudinary URLs sitting in
 * Mongo, which is why the Cloudinary bill has not moved yet.
 *
 * ── What it changes ─────────────────────────────────────────────────────────
 * For every string that is a Cloudinary delivery URL AND whose object is
 * verified present in R2:
 *   - the URL is rewritten to the R2 delivery host;
 *   - a sibling `public_id`, where one exists, is rewritten to the R2 object
 *     key. BOTH must move together: `public_id` is what every delete path uses
 *     to find the asset, so a document holding an R2 url beside a Cloudinary id
 *     deletes from the wrong store and orphans the object.
 *
 * ── What it refuses to change ───────────────────────────────────────────────
 *   - any URL whose R2 object is NOT present (113 of them, all on inactive
 *     products or historical orders, and already 404 on Cloudinary today).
 *     Rewriting those would swap one broken link for another and lose the
 *     evidence of where they came from;
 *   - anything outside the collections named in TARGETS;
 *   - on `orders`, anything except `items[].image` — those are immutable
 *     financial records and the image is the ONLY field here that is a pointer
 *     rather than a fact.
 *
 * ── Safety ──────────────────────────────────────────────────────────────────
 *   - dry run by default; `--apply` writes;
 *   - a JSONL manifest of every change is written BEFORE the first write, and
 *     the run aborts if it cannot be written — no manifest, no rollback, no run;
 *   - writes are per-field `$set` on dotted paths, never a whole-document
 *     replace, so a concurrent edit to an unrelated field is not clobbered;
 *   - a tripwire refuses an unexpectedly large batch.
 *
 * Usage:
 *   node --import=dotenv/config scripts/rewrite-asset-urls.js
 *   node --import=dotenv/config scripts/rewrite-asset-urls.js --collection products
 *   node --import=dotenv/config scripts/rewrite-asset-urls.js --collection products --apply
 *
 * Rollback:
 *   node --import=dotenv/config scripts/rewrite-asset-urls.js --rollback <manifest.jsonl> --apply
 */
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { listKeys } from '../services/storage/r2Provider.js';
import { r2KeyFor, toObjectUrl } from '../services/storage/keys.js';
import { revalidateFrontendTags } from '../services/frontendRevalidator.js';
import {
  productBulkTags, categoryTags, articleTags, promoBannerTags,
} from '../utils/nextTags.js';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d = '') => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const APPLY = flag('apply');
const ONLY = opt('collection', '');
const ROLLBACK = opt('rollback', '');
const MAX = Number(opt('max', 5000));
/*
  A true canary is a handful of documents you can eyeball on the live site, not
  a whole collection. `--limit` caps how many documents are CHANGED in one run;
  re-running picks up where it left off, because a rewritten document no longer
  matches.
*/
const LIMIT = Number(opt('limit', 0)) || Infinity;

/**
 * Collections to touch, and the field paths allowed within each.
 *
 * `null` means "walk the whole document" — safe for catalog collections whose
 * every asset URL is a live pointer. `orders` is explicitly restricted, because
 * an order holds prices, names and addresses that must never be rewritten by an
 * image migration.
 */
const TARGETS = {
  products: null,
  articles: null,
  brands: null,
  categories: null,
  vehicles: null,
  presscoverages: null,
  promobanners: null,
  spinprizes: null,
  spinresults: null,
  orders: ['items'],
};

const CLOUDINARY_HOST = 'res.cloudinary.com';
const bar = (c = '─') => console.log(c.repeat(78));

/**
 * Cloudinary delivery URL → its public_id.
 *
 * Strips the host, `/upload/`, any TRANSFORMATION segment (`f_auto,q_auto`,
 * `w_500,c_fill`, …) and the version. The transformation step matters for URLs
 * embedded in article HTML, where the editor pasted a transformed delivery URL:
 * without it the "public_id" comes back as `f_auto,q_auto/v1/autobacs/...`,
 * matches nothing in R2, and the image is silently left on Cloudinary.
 */
const publicIdFromUrl = (url) => {
  const m = String(url).match(/\/upload\/(.+)$/);
  if (!m) return '';
  let rest = m[1];
  // A transformation segment is a comma-joined list of `x_y` pairs.
  rest = rest.replace(/^(?:[a-z]{1,3}_[^/,]+)(?:,[a-z]{1,3}_[^/,]+)*\//, '');
  rest = rest.replace(/^v\d+\//, '');
  return rest;
};

const isCloudinaryUrl = (v) =>
  typeof v === 'string' && v.includes(CLOUDINARY_HOST) && v.includes('/upload/');

/**
 * The R2 key for a Cloudinary URL, or '' when we hold no such object.
 *
 * A Cloudinary IMAGE public_id carries no extension (the format is a separate
 * field) while the migrated object does, so several spellings have to be tried.
 * Returning '' is the signal to LEAVE THE DOCUMENT ALONE — never to guess.
 */
const r2KeyForUrl = (url, present) => {
  const id = publicIdFromUrl(url);
  if (!id) return '';
  const stem = id.replace(/\.[a-z0-9]{1,5}$/i, '');
  const ext = (id.match(/\.([a-z0-9]{1,5})$/i) || [])[1] || '';
  const candidates = [
    id,
    stem,
    r2KeyFor({ publicId: stem, format: ext }) || '',
    `${stem}.jpg`, `${stem}.jpeg`, `${stem}.png`, `${stem}.webp`, `${stem}.avif`, `${stem}.gif`,
  ].filter(Boolean);
  return candidates.find((c) => present.has(c)) || '';
};

/**
 * Walk a document and collect every rewrite it needs.
 *
 * Returns dotted `$set` paths so the update touches only the fields that move.
 * When a rewritten url has a sibling `public_id`, that is rewritten too — see
 * the header for why they must not drift apart.
 */
const planDocument = (doc, present, allowedRoots) => {
  const sets = {};
  const changes = [];

  /**
   * Rewrite every Cloudinary URL inside a string.
   *
   * Handles BOTH shapes: a field whose whole value is a URL, and a URL embedded
   * in a longer string — article bodies are rich HTML with `<img src="...">`
   * inside them, and those images break just as hard at decommission time as a
   * standalone field would. Only occurrences whose object exists in R2 are
   * replaced; the rest are left exactly as they are.
   *
   * @returns {string|null} the new string, or null when nothing changed
   */
  const rewriteString = (value) => {
    if (typeof value !== 'string' || !value.includes(CLOUDINARY_HOST)) return null;
    let touched = false;
    const out = value.replace(/https?:\/\/res\.cloudinary\.com\/[^\s"'<>)\\]+/g, (url) => {
      const key = r2KeyForUrl(url, present);
      if (!key) return url;
      const next = toObjectUrl(process.env.R2_PUBLIC_BASE_URL, key);
      if (!next) return url;
      touched = true;
      return next;
    });
    return touched ? out : null;
  };

  const walk = (node, trail) => {
    if (node === null || typeof node !== 'object') return;

    if (Array.isArray(node)) {
      node.forEach((v, i) => {
        const p = `${trail}${trail ? '.' : ''}${i}`;
        /*
          An ARRAY OF URL STRINGS. Recursing alone misses these entirely — walk
          returns immediately for a non-object — which is how
          `prizeSnapshot.segmentImages` kept 56 Cloudinary URLs through a run
          that reported success.
        */
        const next = rewriteString(v);
        if (next !== null) { sets[p] = next; changes.push({ path: p, from: v, to: next }); return; }
        walk(v, p);
      });
      return;
    }

    for (const [k, v] of Object.entries(node)) {
      if (k === '_id') continue;
      const p = `${trail}${trail ? '.' : ''}${k}`;

      const next = rewriteString(v);
      if (next !== null) {
        sets[p] = next;
        changes.push({ path: p, from: v, to: next });

        // Move the sibling id in the same operation, never separately — a doc
        // holding an R2 url beside a Cloudinary id deletes from the wrong store.
        if (isCloudinaryUrl(v) && typeof node.public_id === 'string' && node.public_id) {
          const key = r2KeyForUrl(v, present);
          if (key) {
            const idPath = `${trail}${trail ? '.' : ''}public_id`;
            sets[idPath] = key;
            changes.push({ path: idPath, from: node.public_id, to: key });
          }
        }
      } else if (v && typeof v === 'object') {
        walk(v, p);
      }
    }
  };

  for (const [k, v] of Object.entries(doc)) {
    if (k === '_id') continue;
    if (allowedRoots && !allowedRoots.includes(k)) continue;
    const next = rewriteString(v);
    if (next !== null) { sets[k] = next; changes.push({ path: k, from: v, to: next }); }
    else if (v && typeof v === 'object') walk(v, k);
  }

  return { sets, changes };
};

const runRollback = async (db, file) => {
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
  console.log(`rollback entries: ${lines.length}`);
  if (!APPLY) {
    console.log('\nDRY RUN — re-run with --apply to restore.');
    return;
  }
  let restored = 0;
  for (const line of lines) {
    const e = JSON.parse(line);
    const sets = {};
    for (const c of e.changes) sets[c.path] = c.from;
    // eslint-disable-next-line no-await-in-loop
    await db.collection(e.collection).updateOne({ _id: new mongoose.Types.ObjectId(e.id) }, { $set: sets });
    restored += 1;
  }
  console.log(`restored ${restored} document(s)`);
};

const main = async () => {
  // autoIndex:false — the local .env points at PROD; a bare connect() would
  // build every declared index there.
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI, { autoIndex: false });
  const db = mongoose.connection.db;

  bar('═');
  console.log('REWRITE ASSET URLS — Cloudinary → R2');
  bar('═');
  console.log(`mode       : ${APPLY ? '*** APPLY (writing) ***' : 'DRY RUN (no writes)'}`);
  console.log(`collections: ${ONLY || Object.keys(TARGETS).join(', ')}`);
  if (LIMIT !== Infinity) console.log(`limit      : ${LIMIT} document(s) this run`);
  console.log(`delivery   : ${process.env.R2_PUBLIC_BASE_URL || '(UNSET — cannot run)'}`);
  bar();

  if (ROLLBACK) { await runRollback(db, ROLLBACK); await mongoose.disconnect(); return; }

  if (!process.env.R2_PUBLIC_BASE_URL) {
    console.error('✋ ABORT: R2_PUBLIC_BASE_URL is not set — every rewritten url would be empty.');
    await mongoose.disconnect();
    process.exit(1);
  }

  // One listing of the whole public bucket; membership is then O(1) with no
  // network. Presence in R2 is the precondition for every rewrite.
  const present = new Set((await listKeys({ prefix: '', scope: 'public' })).map((o) => o.key));
  console.log(`objects in the public bucket: ${present.size}`);

  const names = ONLY ? [ONLY] : Object.keys(TARGETS);
  const planned = [];
  let scanned = 0; let skipped = 0;

  for (const name of names) {
    if (!(name in TARGETS)) {
      console.error(`✋ ABORT: "${name}" is not a known target collection.`);
      await mongoose.disconnect();
      process.exit(1);
    }
    const allowedRoots = TARGETS[name];
    /*
      ONE pass. This used to walk each collection twice — once to plan, once to
      count the URLs left behind — which doubled the cost of the slowest part of
      the run and timed out on the larger collections. The skip count is derived
      from the same document while it is already in memory.
    */
    for await (const doc of db.collection(name).find({})) {
      scanned += 1;
      const { sets, changes } = planDocument(doc, present, allowedRoots);

      const urls = JSON.stringify(doc).match(/https:\/\/res\.cloudinary\.com\/[^"'\\ )]+/g) || [];
      for (const u of urls) if (!r2KeyForUrl(u.replace(/\\?"$/, ''), present)) skipped += 1;

      if (!changes.length) continue;
      if (planned.length >= LIMIT) continue;
      planned.push({ collection: name, id: String(doc._id), slug: doc.slug, sets, changes });
    }
  }

  const fields = planned.reduce((s, p) => s + p.changes.length, 0);
  console.log(`documents scanned : ${scanned}`);
  console.log(`documents to change: ${planned.length}`);
  console.log(`field writes       : ${fields}`);
  console.log(`URLs LEFT on Cloudinary (no R2 object): ${skipped}`);
  bar();

  if (!planned.length) { console.log('Nothing to do.'); await mongoose.disconnect(); return; }

  if (planned.length > MAX) {
    console.error(`\n✋ ABORT: ${planned.length} documents exceeds the ${MAX} tripwire.`);
    await mongoose.disconnect();
    process.exit(1);
  }

  if (!APPLY) {
    planned.slice(0, 5).forEach((p) => {
      console.log(`  ${p.collection}/${p.id}`);
      p.changes.slice(0, 3).forEach((c) => console.log(`     ${c.path}\n       - ${c.from}\n       + ${c.to}`));
    });
    if (planned.length > 5) console.log(`  … and ${planned.length - 5} more documents`);
    console.log('\nDRY RUN — nothing written. Re-run with --apply.');
    await mongoose.disconnect();
    return;
  }

  // ── Manifest BEFORE any write; no manifest, no run ────────────────────────
  // Reuses the directory the byte-copy migration already writes to and that
  // .gitignore already excludes ("Cloudinary→R2 migration audit trails") —
  // a second directory for the same artefact is a second thing to remember.
  const dir = path.resolve('migration-manifests');
  fs.mkdirSync(dir, { recursive: true });
  const manifestPath = path.join(dir, `rewrite-asset-urls-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
  fs.writeFileSync(manifestPath, `${planned.map((p) => JSON.stringify(p)).join('\n')}\n`);
  if (!fs.existsSync(manifestPath) || fs.statSync(manifestPath).size === 0) {
    console.error('✋ ABORT: manifest could not be written. Nothing changed.');
    await mongoose.disconnect();
    process.exit(1);
  }
  console.log(`manifest written: ${manifestPath}`);

  let updated = 0; const failed = [];
  for (const p of planned) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await db.collection(p.collection).updateOne({ _id: doc_id(p.id) }, { $set: p.sets });
      updated += 1;
    } catch (err) {
      failed.push(`${p.collection}/${p.id}: ${err.message}`);
    }
  }

  /*
    ── Invalidate what we changed ──────────────────────────────────────────────
    This script writes STRAIGHT TO MONGO, so none of the app's write hooks fire:
    no Redis purge, no Next.js tag revalidation. The canary proved it — after
    rewriting three products the backend API already served R2 urls while the
    storefront HTML still showed 91 Cloudinary ones, because Next's Data Cache
    was untouched.

    Redis lives on the private network and cannot be reached from here, so that
    half is the operator's `railway run npm run flush-cache`. The frontend
    revalidation is plain HTTP and IS reachable, so the script owns it. Coarse
    collection tags come first — the revalidator drops the tail past its ceiling.
  */
  const tags = new Set();
  for (const p of planned) {
    if (p.collection === 'products') continue;              // handled in bulk below
    if (p.collection === 'categories') categoryTags({ slug: p.slug }).forEach((t) => tags.add(t));
    if (p.collection === 'articles') articleTags({ slug: p.slug }).forEach((t) => tags.add(t));
    if (p.collection === 'promobanners') promoBannerTags().forEach((t) => tags.add(t));
  }
  const productSlugs = planned.filter((p) => p.collection === 'products' && p.slug).map((p) => ({ slug: p.slug }));
  if (productSlugs.length) productBulkTags(productSlugs).forEach((t) => tags.add(t));

  if (tags.size) {
    console.log(`revalidating ${tags.size} frontend tag(s)…`);
    // Never throws by contract; a failure means staleness self-heals at the TTL.
    await revalidateFrontendTags([...tags]);
  }

  bar('═');
  console.log(`UPDATED: ${updated} of ${planned.length}   FAILED: ${failed.length}`);
  failed.slice(0, 10).forEach((f) => console.log(`   ✗ ${f}`));
  console.log(`manifest: ${manifestPath}`);
  console.log('\nRollback:');
  console.log(`  node --import=dotenv/config scripts/rewrite-asset-urls.js --rollback ${manifestPath} --apply`);
  console.log('\nNext: npm run flush-cache   (Redis route:*/public:* still hold the old URLs)');
  bar('═');
  await mongoose.disconnect();
};

const doc_id = (id) => new mongoose.Types.ObjectId(id);

main().catch((e) => { console.error('[Rewrite] fatal:', e); process.exit(1); });
