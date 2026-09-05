/**
 * Remove product gallery entries whose Cloudinary asset no longer exists.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * The admin update path used to delete an image from Cloudinary while leaving
 * its URL on the product: the gallery was only rewritten when the same request
 * also uploaded a new image, but the Cloudinary cleanup ran regardless. Every
 * "remove this image and save" therefore stranded a dead URL in Mongo — a
 * broken image on the PDP and listings, which reappeared in the admin form on
 * every reload because the DB still listed it.
 *
 * That bug is fixed (controllers/productImageController.js now derives cleanup
 * from what actually persisted, so an asset can never outlive its row or vice
 * versa). This script cleans up the rows the old behaviour already left behind.
 *
 * ── How "dead" is decided ───────────────────────────────────────────────────
 * Cloudinary's Admin API is the authority: `resources_by_ids` is asked about
 * every public_id in batches, and an id is dead ONLY when the call succeeded
 * and the id was absent from the response. A failed/rate-limited batch aborts
 * the run rather than marking anything dead — "we could not check" must never
 * be read as "it is gone".
 *
 * Images with no public_id (migrated WooCommerce rows pointing at wp-content)
 * cannot be checked this way. They are skipped unless --check-urls is passed,
 * which HEAD-requests each distinct URL instead.
 *
 * ── Safety ──────────────────────────────────────────────────────────────────
 *   • DRY-RUN by default; needs --apply to write.
 *   • Tripwire: aborts if more than --max-dead-ratio (default 0.20) of the
 *     checked assets look dead. The overwhelmingly likely cause of a mass
 *     "everything is missing" reading is CLOUDINARY_CLOUD_NAME / API key
 *     pointing at the wrong account — and without this guard the script would
 *     cheerfully empty every gallery in the catalogue.
 *   • Never deletes anything FROM Cloudinary. It only removes DB rows that
 *     point at assets already gone. There is nothing to un-delete.
 *   • Re-indexes each cleaned product in Elasticsearch directly, and refuses to
 *     --apply if ES is unreachable — a clean Mongo alongside an index still
 *     advertising the removed images is worse than the broken images.
 *   • Idempotent: a second pass finds nothing.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *   node --import=dotenv/config scripts/sweep-dead-product-images.js   # dry run
 *   node ... --check-urls          # also HEAD-check non-Cloudinary/legacy URLs
 *   node ... --max-dead-ratio=0.5  # raise the tripwire (know why first)
 *
 *   # Against prod — needs the real env for Mongo/Cloudinary/Elasticsearch:
 *   railway run --environment production --service EcommerceAutobacs -- \
 *     npm run sweep-dead-product-images -- --apply
 *
 * ── Order of operations (learned the hard way) ───────────────────────────────
 * Mongo → Elasticsearch → cache. The script does the first two; run
 * `npm run flush-cache` LAST, in the same environment. Flushing before the
 * re-index just re-caches the stale search result on the next request.
 *
 * Note `railway run` does not exit cleanly here (an open Redis handle from the
 * imported modules keeps the loop alive) — the work completes, but you may need
 * to Ctrl-C, and piped output is buffered. Redirect to a file if you need to
 * read the report while it runs.
 */

import mongoose from 'mongoose';
import cloudinary from '../config/cloudinary.js';
import Product from '../models/Product.js';
// Registered so the populate() calls below resolve — the running server imports
// these transitively at boot, a standalone script must do it explicitly or
// populate('categories'|'compatibleVehicles') throws MissingSchemaError.
import '../models/Category.js';
import '../models/Vehicle.js';
import elasticsearchService from '../services/elasticsearchService.js';
import { imageKey, planGalleryCleanup } from '../utils/productGallery.js';
import { pruneDanglingPointers } from '../utils/variantImage.js';

const TAG = '[sweep-dead-product-images]';

const APPLY             = process.argv.includes('--apply');
const CHECK_URLS        = process.argv.includes('--check-urls');
const ALLOW_STALE_SEARCH = process.argv.includes('--allow-stale-search');

/** Read a `--name=value` flag. */
const flag = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const MAX_DEAD_RATIO = Number(flag('max-dead-ratio', '0.2'));
/** Cloudinary caps resources_by_ids at 100 public_ids per call. */
const BATCH = 100;

const isCloudinaryUrl = (url) => typeof url === 'string' && url.includes('cloudinary.com');

/**
 * Progress that stays readable when the output is piped or captured to a log:
 * carriage-return overwriting only works on a TTY, so elsewhere fall back to
 * one line per milestone rather than a single unreadable smear.
 */
const progress = (done, total, label) => {
  if (process.stdout.isTTY) {
    process.stdout.write(`\r${TAG} checked ${done}/${total} ${label}`);
    if (done >= total) process.stdout.write('\n');
  } else if (done >= total) {
    console.log(`${TAG} checked ${done}/${total} ${label}`);
  }
};

// ── Connection ───────────────────────────────────────────────────────────────

async function connect() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI / MONGO_URI not set');
  await mongoose.connect(uri);
  console.log(`${TAG} connected to Mongo`);
}

function assertCloudinaryConfigured() {
  const missing = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']
    .filter((v) => !process.env[v]);
  if (missing.length) {
    throw new Error(
      `Cloudinary is not configured (${missing.join(', ')}). Without it every asset ` +
      'would look missing and the sweep would empty every gallery.'
    );
  }
  console.log(`${TAG} Cloudinary cloud: ${process.env.CLOUDINARY_CLOUD_NAME}`);
}

/**
 * Confirm we can actually keep Elasticsearch in step before writing anything.
 *
 * This script indexes ES DIRECTLY rather than going through the search-sync
 * queue, and that is deliberate. The schema's post('updateOne') hook does
 * enqueue a sync, but (a) it is fire-and-forget, so a short-lived script exits
 * before the job reaches Redis, and (b) QUEUE_REDIS_URL in production is
 * `redis.railway.internal` — a private-network host that only resolves from
 * inside Railway, so `railway run` cannot reach the queue at all. Both were
 * observed on the first prod run: Mongo was cleaned while search kept serving
 * the removed images.
 *
 * ES itself is a public hosted cluster, so a direct index works from anywhere.
 */
async function assertSearchSyncWillFire() {
  if (!APPLY) return;

  const enabled = process.env.ELASTICSEARCH_ENABLED === 'true';
  const connected = enabled && await elasticsearchService.isConnected().catch(() => false);
  if (connected) return;

  const why = enabled
    ? 'Elasticsearch is enabled but unreachable'
    : `ELASTICSEARCH_ENABLED=${process.env.ELASTICSEARCH_ENABLED || 'unset'}`;

  if (ALLOW_STALE_SEARCH) {
    console.warn(
      `${TAG} ⚠ ${why} — proceeding because --allow-stale-search was passed. ` +
      'Search will keep serving the removed images until you reindex.'
    );
    return;
  }

  throw new Error(
    `Refusing to --apply: ${why}, so search would keep serving the dead image ` +
    'URLs this sweep removes.\n' +
    '  Run against the real environment instead:\n' +
    '    railway run --environment production --service EcommerceAutobacs -- \\\n' +
    '      npm run sweep-dead-product-images -- --apply\n' +
    '  Or accept the drift and fix search separately:\n' +
    '    ... -- --apply --allow-stale-search'
  );
}

// ── Liveness probes ──────────────────────────────────────────────────────────

/**
 * Ask Cloudinary which of these public_ids still exist.
 * Returns the set that DO exist. Throws if a batch could not be checked — the
 * caller must not interpret an API failure as "these assets are gone".
 */
async function findLivePublicIds(publicIds) {
  const alive = new Set();
  const total = publicIds.length;

  for (let i = 0; i < total; i += BATCH) {
    const batch = publicIds.slice(i, i + BATCH);
    let res;
    try {
      res = await cloudinary.api.resources_by_ids(batch);
    } catch (err) {
      throw new Error(
        `Cloudinary lookup failed at batch ${i / BATCH + 1} (${err.message}). ` +
        'Aborting without changes — an unchecked asset is never treated as dead.'
      );
    }
    (res.resources || []).forEach((r) => alive.add(r.public_id));
    progress(Math.min(i + BATCH, total), total, 'Cloudinary assets');
  }
  return alive;
}

/**
 * HEAD-check plain URLs (legacy wp-content images with no public_id).
 * A network error leaves the URL considered ALIVE — same rule as above: only a
 * definitive 404/410 from a reachable host counts as dead.
 */
async function findLiveUrls(urls) {
  const alive = new Set();
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    try {
      const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
      if (res.status !== 404 && res.status !== 410) alive.add(url);
    } catch {
      alive.add(url); // unreachable ≠ confirmed gone
    }
    progress(i + 1, urls.length, 'legacy URLs');
  }
  return alive;
}

// ── Elasticsearch ────────────────────────────────────────────────────────────

/**
 * OBSOLETE since the move to Atlas Search (2026-08-31), kept as a no-op guard.
 *
 * Atlas Search indexes the products collection directly via change streams, so a
 * cleaned product is searchable with its corrected images without any explicit
 * re-index step. The Elasticsearch path this mirrored — searchSyncWorker's
 * 'es-sync-product' handler — no longer exists. The ELASTICSEARCH_ENABLED guard
 * below is now always false in every environment, so this returns 0 and the
 * caller's cache flush is still what makes the change visible.
 */
async function syncSearchIndex(ids) {
  if (!ids.length || process.env.ELASTICSEARCH_ENABLED !== 'true') return 0;

  let synced = 0;
  for (const id of ids) {
    try {
      const product = await Product
        .findById(id, null, { includeDeleted: true })
        .populate('categories', 'name slug')
        .populate('compatibleVehicles', 'make model');

      if (!product || product.deletedAt !== null) {
        await elasticsearchService.deleteProduct(id, { refresh: 'wait_for' });
      } else {
        await elasticsearchService.indexProduct(product, { refresh: 'wait_for' });
      }
      synced++;
    } catch (err) {
      console.error(`${TAG} ⚠ Elasticsearch sync FAILED for ${id}: ${err.message}`);
      process.exitCode = 1;
    }
  }

  console.log(`${TAG} re-indexed ${synced}/${ids.length} product(s) in Elasticsearch`);
  return synced;
}

// ── Run ──────────────────────────────────────────────────────────────────────

async function run() {
  assertCloudinaryConfigured();
  // Checked before any Cloudinary/Mongo work so a misconfigured --apply fails in
  // a second rather than after a few thousand API calls.
  await assertSearchSyncWillFire();
  await connect();

  /*
    `variants` is projected because a model's photo is a POINTER into this
    gallery (`variants[].imageKey`). Removing a dead image without clearing the
    pointers at it would leave the document self-inconsistent — reads still fall
    back to the product image, so nothing breaks visibly, but "is this asset
    still referenced?" becomes unanswerable, which is the one question the
    ownership cleanup has to get right.
  */
  const products = await Product.find(
    { 'images.0': { $exists: true } },
    '_id name slug images variants',
  ).lean();

  console.log(`${TAG} ${products.length} product(s) with at least one image`);

  // Gather the distinct assets to probe. Same asset can appear on many products.
  const publicIds = new Set();
  const legacyUrls = new Set();
  for (const p of products) {
    for (const img of p.images || []) {
      if (img.public_id) publicIds.add(img.public_id);
      else if (isCloudinaryUrl(img.url)) publicIds.add(null); // unusable — counted below
      else if (img.url) legacyUrls.add(img.url);
    }
  }
  publicIds.delete(null);

  console.log(
    `${TAG} ${publicIds.size} distinct Cloudinary asset(s), ` +
    `${legacyUrls.size} legacy URL(s)${CHECK_URLS ? '' : ' (skipped — pass --check-urls)'}`
  );

  const alivePublicIds = await findLivePublicIds([...publicIds]);
  const aliveUrls = CHECK_URLS ? await findLiveUrls([...legacyUrls]) : null;

  /**
   * An image is alive unless positively confirmed missing. Anything we did not
   * or could not check stays alive by construction.
   */
  const isAlive = (img) => {
    if (img.public_id) return alivePublicIds.has(img.public_id);
    if (aliveUrls && img.url && !isCloudinaryUrl(img.url)) return aliveUrls.has(img.url);
    return true;
  };

  // ── Tripwire ──────────────────────────────────────────────────────────────
  const checkedCount = publicIds.size + (CHECK_URLS ? legacyUrls.size : 0);
  const deadCount =
    (publicIds.size - alivePublicIds.size) +
    (aliveUrls ? legacyUrls.size - aliveUrls.size : 0);
  const ratio = checkedCount ? deadCount / checkedCount : 0;

  console.log(
    `${TAG} ${deadCount}/${checkedCount} checked asset(s) are missing ` +
    `(${(ratio * 100).toFixed(1)}%)`
  );

  if (checkedCount > 0 && ratio > MAX_DEAD_RATIO) {
    console.error(
      `\n${TAG} ABORTING — ${(ratio * 100).toFixed(1)}% of assets look missing, over the ` +
      `${(MAX_DEAD_RATIO * 100).toFixed(0)}% tripwire.\n` +
      `${TAG} This almost always means the credentials point at the WRONG Cloudinary ` +
      `account (cloud: ${process.env.CLOUDINARY_CLOUD_NAME}), not that the catalogue ` +
      'genuinely lost its images. Verify, then re-run with --max-dead-ratio if it is real.'
    );
    await mongoose.disconnect();
    process.exitCode = 1;
    return;
  }

  // ── Plan ──────────────────────────────────────────────────────────────────
  const plans = [];
  for (const product of products) {
    const plan = planGalleryCleanup(product, isAlive);
    if (plan.changed) plans.push({ product, ...plan });
  }

  if (plans.length === 0) {
    console.log(`${TAG} nothing to clean — every gallery points at a live asset.`);
    await mongoose.disconnect();
    return;
  }

  const totalDead = plans.reduce((n, p) => n + p.dead.length, 0);
  const emptied = plans.filter((p) => p.emptied);

  console.log(`\n${TAG} ${totalDead} dead image row(s) across ${plans.length} product(s):`);
  for (const { product, dead, survivors } of plans.slice(0, 50)) {
    console.log(
      `  - ${product.name} (${product.slug || product._id}): ` +
      `${dead.length} dead, ${survivors.length} left`
    );
    dead.forEach((img) => console.log(`      × ${imageKey(img)}`));
  }
  if (plans.length > 50) console.log(`  … and ${plans.length - 50} more`);

  if (emptied.length) {
    console.log(
      `\n${TAG} ⚠ ${emptied.length} product(s) will be left with NO images and need ` +
      'new ones uploaded (they are already rendering broken today):'
    );
    emptied.forEach(({ product }) =>
      console.log(`      ! ${product.name} (${product.slug || product._id})`));
  }

  if (!APPLY) {
    console.log(`\n${TAG} DRY RUN — re-run with --apply to write.`);
    await mongoose.disconnect();
    return;
  }

  // ── Apply ─────────────────────────────────────────────────────────────────
  // updateOne (not save()) so a legacy row that would fail full-document
  // validation still gets its dead images removed — and because the schema's
  // post('updateOne') hook enqueues the Elasticsearch sync for this _id.
  let updated = 0;
  const failures = [];
  const syncedIds = [];
  for (const { product, survivors } of plans) {
    try {
      /*
        Pointers are pruned against the SURVIVING gallery in the same $set, so
        the document is never briefly inconsistent and a crash between two
        writes cannot leave pointers at images that are already gone.

        Deliberately NOT reclaiming variant-owned survivors here: this sweep's
        one job is removing rows whose asset is confirmed missing. Deleting live
        assets is the write path's decision, made with the admin's full intent in
        hand. A maintenance script that also destroys present-and-correct images
        is how a cleanup run becomes an incident.
      */
      const update = { images: survivors };
      if (Array.isArray(product.variants) && product.variants.length) {
        const pruned = pruneDanglingPointers(survivors, product.variants);
        const changed = pruned.some((v, i) => v.imageKey !== product.variants[i]?.imageKey);
        if (changed) update.variants = pruned;
      }
      await Product.updateOne({ _id: product._id }, { $set: update });
      updated++;
      syncedIds.push(product._id.toString());
    } catch (err) {
      failures.push({ id: product._id, name: product.name, error: err.message });
    }
  }

  console.log(`\n${TAG} APPLIED — cleaned ${updated}/${plans.length} product(s).`);
  if (failures.length) {
    console.error(`${TAG} ${failures.length} product(s) FAILED to update:`);
    failures.forEach((f) => console.error(`      ! ${f.name} (${f.id}): ${f.error}`));
    process.exitCode = 1;
  }

  // Search index BEFORE the cache advice below — order matters. Flushing while
  // ES is still stale just re-caches the stale answer on the next request,
  // which is exactly what happened on the first prod run.
  await syncSearchIndex(syncedIds);

  console.log(
    `\n${TAG} LAST STEP: run \`npm run flush-cache\` (same environment) so Redis/CDN ` +
    'stop serving the old galleries. Do it now that search is up to date — flushing ' +
    'before the re-index above would simply re-cache the stale result.'
  );

  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error(`${TAG} failed:`, err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
