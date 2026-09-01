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
import { VARIANT_PREFIX } from '../services/storage/variants.js';
import { isR2Configured, missingR2Vars } from '../config/storage.js';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => { const h = argv.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };

const APPLY = flag('apply');
const FORCE = flag('force');
const PREFIX = opt('prefix', '');
const LIMIT = Number(opt('limit', Infinity));
const CONCURRENCY = Number(opt('concurrency', 3));

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

  console.log('Listing originals in the public bucket…');
  const all = await r2.listKeys({ prefix: PREFIX, scope: 'public' });

  /*
    Skip anything already under `variants/` — otherwise a second run would treat
    its own output as new source material and generate variants of variants,
    which is both wrong and unbounded.
  */
  const originals = all
    .filter((o) => !o.key.startsWith(`${VARIANT_PREFIX}/`))
    .filter((o) => IMAGE_EXT.test(o.key))
    .slice(0, LIMIT);

  console.log(`  objects in bucket : ${all.length}`);
  console.log(`  originals to render: ${originals.length}`);
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
          // Dry run: report intent without downloading or encoding anything.
          done += 1;
          if (done % 250 === 0) console.log(`  [${done}/${originals.length}] would render ${o.key}`);
          continue;
        }
        const buffer = await r2.getObjectBuffer({ key: o.key, scope: 'public' });
        const res = await generateVariants({
          buffer,
          originalKey: o.key,
          putObject: r2.putObject,
          headObject: r2.headObject,
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
