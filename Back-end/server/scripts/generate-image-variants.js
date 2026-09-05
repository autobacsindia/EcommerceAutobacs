/**
 * Backfill pre-generated AVIF/WebP variants for every public image in R2.
 *
 * Run AFTER scripts/migrate-cloudinary-to-r2.js has copied the originals. Reads
 * each original from R2, renders the width ladder into both formats, and writes
 * them back under `variants/`. Touches MongoDB not at all and never deletes.
 *
 * ── Why this is a separate pass from the byte copy ──────────────────────────
 * The copy is I/O bound and fast; this is CPU bound and slow (AVIF encoding is
 * deliberately expensive — paid once here, saved on every request forever).
 * Splitting them means a failure in encoding never forces a re-download of
 * 800 MB, and the copy can be verified complete before any CPU is spent.
 *
 * ── Resumability ────────────────────────────────────────────────────────────
 * Every variant that already exists in R2 is skipped, so an interrupted run
 * resumes by simply re-running. That check is per-variant, not per-image, so a
 * run that died halfway through one image's ladder picks up mid-image. Use
 * --force only to re-render after changing the ladder or the encoder settings.
 *
 * ── Cost shape ──────────────────────────────────────────────────────────────
 * ~6,200 public images. Most are <= 1080px wide, so the no-upscale rule means
 * the average image produces well under the full 7-rung ladder. Writes are R2
 * Class A operations; the free tier covers 1M/month, so a full backfill is
 * comfortably inside it.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *   cd Back-end/server
 *   node --import=dotenv/config scripts/generate-image-variants.js
 *   node --import=dotenv/config scripts/generate-image-variants.js --apply
 *
 *   --apply            actually write (default: dry run)
 *   --prefix=<path>    only originals under this key prefix
 *   --limit=<n>        stop after n originals (smoke test)
 *   --concurrency=<n>  images in flight (default 3 — this is CPU bound)
 *   --force            re-render variants that already exist
 */
import fs from 'fs';
import path from 'path';
import * as r2 from '../services/storage/r2Provider.js';
import { generateVariants } from '../services/storage/variantGenerator.js';
import { VARIANT_PREFIX, variantPrefixFor, FULL_RUNG, LADDER } from '../services/storage/variants.js';
import { isR2Configured, missingR2Vars } from '../config/storage.js';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => { const h = argv.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };

const APPLY = flag('apply');
const FORCE = flag('force');
const PREFIX = opt('prefix', '');
const LIMIT = Number(opt('limit', Infinity));
/*
  Default raised from 3: the work is network-latency bound, not CPU bound
  (measured 75% idle CPU while the sequential version ran), so more images in
  flight is close to free.
*/
const CONCURRENCY = Number(opt('concurrency', 12));

const mb = (b) => (b / 1048576).toFixed(1);
const bar = (c = '─') => console.log(c.repeat(76));

/** Image extensions we generate variants for. Anything else is left alone. */
const IMAGE_EXT = /\.(jpe?g|png|webp|avif|gif)$/i;

const main = async () => {
  bar('═');
  console.log('GENERATE IMAGE VARIANTS (AVIF + WebP)');
  bar('═');
  console.log(`mode       : ${APPLY ? '*** APPLY (writing) ***' : 'DRY RUN (no writes)'}`);
  console.log(`prefix     : ${PREFIX || '(all public originals)'}`);
  console.log(`concurrency: ${CONCURRENCY}`);
  console.log(`force      : ${FORCE}`);
  bar();

  if (!isR2Configured()) {
    console.error(`[Variants] R2 is not configured. Missing: ${missingR2Vars().join(', ')}`);
    console.error('           Add the R2_* vars to Back-end/server/.env (they are on Railway,');
    console.error('           but this script runs locally against the same buckets).');
    process.exit(1);
  }

  /*
    ── Two listings, deliberately ─────────────────────────────────────────────

    `--prefix` narrows the ORIGINALS only. It must never narrow the variants
    listing, because that listing is what decides which originals are already
    done — and `variants/<prefix>` does not start with `<prefix>`.

    This was a live trap. `--prefix=autobacs/products` excluded every
    `variants/…` key from the single listing this used to do, so `existingKeys`
    came back empty, `originalsDone` came back empty, and the dry run reported
    6,405 originals to render when the true figure was 380. An --apply would
    then have re-downloaded and re-encoded all 6,405 — tens of thousands of
    pointless writes and hours of AVIF encoding, with no error and no clue why.

    The header already records an earlier version of this same bug ("a dry run
    that overstates the work by three orders of magnitude is one nobody reads").
    That fix landed in the skip logic; the flag still routed around it.
  */
  console.log('Listing originals in the public bucket…');
  const sourceObjects = await r2.listKeys({ prefix: PREFIX, scope: 'public' });
  const variantObjects = PREFIX
    ? await r2.listKeys({ prefix: `${VARIANT_PREFIX}/`, scope: 'public' })
    : sourceObjects;
  const all = sourceObjects;

  /*
    Skip anything already under `variants/` — otherwise a second run would treat
    its own output as new source material and generate variants of variants,
    which is both wrong and unbounded.
  */
  const originals = all
    .filter((o) => !o.key.startsWith(`${VARIANT_PREFIX}/`))
    .filter((o) => IMAGE_EXT.test(o.key))
    .slice(0, LIMIT);

  /*
    One LIST of the variants/ prefix instead of a HEAD per planned variant.

    Measured: an R2 round-trip from here is ~316ms, and a 1080px source plans 10
    variants, so per-variant HEADs cost ~3.2s PER IMAGE — and on a first run
    every one returns 404. Across 6,243 originals that is ~62,000 requests spent
    proving the bucket is empty. The listing is already in `all`, so this costs
    nothing extra.
  */
  const existingKeys = new Set(
    variantObjects.filter((o) => o.key.startsWith(`${VARIANT_PREFIX}/`)).map((o) => o.key),
  );

  /*
    Which originals already have SOME variant. Derived once here rather than
    scanned per original: `[...existingKeys].some(startsWith)` inside the loop is
    O(variants × originals) — 60k × 6k — which turns a 3-second dry run into
    minutes of pure CPU for a number we can precompute in one pass.
  */
  const originalsDone = new Set();
  {
    const byPrefix = new Map();
    for (const k of existingKeys) {
      const cut = k.lastIndexOf('/');
      if (cut <= 0) continue;
      const prefix = k.slice(0, cut + 1);
      const leaf = k.slice(cut + 1);
      if (!byPrefix.has(prefix)) byPrefix.set(prefix, new Set());
      byPrefix.get(prefix).add(leaf);
    }
    /*
      "Has some variants" is NOT the same as "is complete" — that assumption
      broke the moment the full rung was added, when every original had rungs and
      none had `full`. An original is done when either:
        - `full.avif` exists (the fallback the Worker needs), or
        - `w1920.avif` exists, meaning the source is at least as wide as the top
          rung, so pickWidth can never ask for something it cannot serve and no
          full variant is planned.
    */
    for (const [prefix, leaves] of byPrefix) {
      if (leaves.has(`${FULL_RUNG}.avif`) || leaves.has(`w${LADDER[LADDER.length - 1]}.avif`)) {
        originalsDone.add(prefix);
      }
    }
  }

  console.log(`  objects in bucket  : ${all.length}`);
  console.log(`  originals to render: ${originals.length}`);
  console.log(`  variants present   : ${existingKeys.size} (skipped without a network probe)`);
  bar();

  if (!originals.length) {
    console.log('Nothing to do. Has the byte copy (migrate-to-r2) run yet?');
    return;
  }

  let done = 0; let written = 0; let skipped = 0; let bytesOut = 0;
  const failures = [];
  let cursor = 0;

  const worker = async () => {
    while (cursor < originals.length) {
      const o = originals[cursor++];
      try {
        if (!APPLY) {
          /*
            Dry run: report intent without downloading or encoding anything.

            The exact plan needs the source dimensions, which needs the bytes —
            so instead we ask whether this original has ANY variant already. That
            is a good proxy: the ladder is written per original in one pass, so
            "some variants exist" means "this one is done".

            This check used to be absent, and the dry run said "would render" for
            every original — 6,244 of them when 6,243 were already complete. A
            dry run that overstates the work by three orders of magnitude is one
            nobody reads, which defeats the point of having one.
          */
          done += 1;
          const prefix = variantPrefixFor(o.key);
          if (prefix && originalsDone.has(prefix)) { skipped += 1; continue; }
          written += 1;
          if (written <= 20) console.log(`  would render ${o.key}`);
          continue;
        }
        const buffer = await r2.getObjectBuffer({ key: o.key, scope: 'public' });
        const res = await generateVariants({
          buffer,
          originalKey: o.key,
          putObject: r2.putObject,
          existingKeys,          // O(1) membership instead of a HEAD per variant
          force: FORCE,
        });
        written += res.written; skipped += res.skipped; bytesOut += res.bytes;
        res.failed.forEach((f) => failures.push(`${f.key}: ${f.error}`));
        done += 1;
        if (done % 100 === 0) {
          console.log(`  [${done}/${originals.length}] ${written} written, ${skipped} skipped, ${mb(bytesOut)} MB`);
        }
      } catch (err) {
        done += 1;
        failures.push(`${o.key}: ${err.message}`);
        console.error(`  ✗ ${o.key}: ${err.message}`);
      }
    }
  };

  await Promise.all(Array.from(
    { length: Math.max(1, Math.min(CONCURRENCY, originals.length)) }, worker,
  ));

  bar('═');
  console.log(`originals processed : ${done}`);
  console.log(`variants written    : ${written}  (${mb(bytesOut)} MB)`);
  console.log(`variants skipped    : ${skipped}  (already present)`);
  console.log(`failures            : ${failures.length}`);
  bar('═');

  if (failures.length) {
    const dir = path.resolve('migration-manifests');
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, `variant-failures-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`);
    fs.writeFileSync(p, `${failures.join('\n')}\n`);
    console.log(`failure list: ${p}`);
    console.log('Re-running retries only these — successful variants are skipped as present.');
  }

  if (!APPLY) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply.');
  } else {
    console.log('\nVerify one before pointing the site at it:');
    console.log("  curl -I -H 'Accept: image/avif' https://img.autobacsindia.com/variants/<key>/w640");
  }
};

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error('[Variants] fatal:', err); process.exit(1); });
