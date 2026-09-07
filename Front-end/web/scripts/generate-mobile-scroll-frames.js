#!/usr/bin/env node
/**
 * Derive the MOBILE hero scroll-frame set from the desktop set.
 *
 * The desktop sequence is 145 frames at 1440x808. Shipping that to phones is not
 * viable: ~5 MB on the wire, and because HeroSequence holds every decoded frame
 * at once, ~674 MB of resident ImageBitmap memory (1440*808*4 bytes each) — well
 * past the per-tab budget iOS Safari kills a page over.
 *
 * So mobile gets its own set: every Nth frame, downscaled. At the defaults
 * (step 3, width 720) that is 49 frames at 720x404 — ~0.5 MB on the wire and
 * ~57 MB decoded, which fits comfortably.
 *
 * The last desktop frame is always included regardless of step, so the mobile
 * scrub still ends on the same pose the desktop one does.
 *
 * Usage:
 *   node scripts/generate-mobile-scroll-frames.js            # dry run
 *   node scripts/generate-mobile-scroll-frames.js --apply
 *   node scripts/generate-mobile-scroll-frames.js --apply --step 3 --width 720
 *
 * Rollback: rm -rf public/scroll-frames-mobile (the desktop set is untouched).
 */
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const SRC_DIR = path.join(__dirname, '..', 'public', 'scroll-frames');
const OUT_DIR = path.join(__dirname, '..', 'public', 'scroll-frames-mobile');
const PAD = 4;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || i === process.argv.length - 1) return fallback;
  const n = Number(process.argv[i + 1]);
  return Number.isFinite(n) ? n : fallback;
}

const apply = process.argv.includes('--apply');
const step = arg('step', 3);
const width = arg('width', 720);
const quality = arg('quality', 78);

function frameName(i) {
  return `frame_${String(i).padStart(PAD, '0')}.webp`;
}

async function main() {
  if (!fs.existsSync(SRC_DIR)) {
    console.error(`Source frames not found: ${SRC_DIR}`);
    process.exit(1);
  }
  const source = fs
    .readdirSync(SRC_DIR)
    .filter((f) => /^frame_\d+\.webp$/.test(f))
    .sort();
  if (source.length === 0) {
    console.error(`No frame_*.webp in ${SRC_DIR}`);
    process.exit(1);
  }

  // Every `step`-th frame, plus the final frame so the scrub ends on the same pose.
  const picked = [];
  for (let i = 0; i < source.length; i += step) picked.push(i);
  const last = source.length - 1;
  if (picked[picked.length - 1] !== last) picked.push(last);

  const meta = await sharp(path.join(SRC_DIR, source[0])).metadata();
  const height = Math.round(width * (meta.height / meta.width));
  const srcBytes = source.reduce(
    (sum, f) => sum + fs.statSync(path.join(SRC_DIR, f)).size,
    0
  );

  console.log(`Source : ${source.length} frames @ ${meta.width}x${meta.height} (${(srcBytes / 1e6).toFixed(2)} MB)`);
  console.log(`Output : ${picked.length} frames @ ${width}x${height} (step ${step}, q${quality})`);
  console.log(`Decoded memory: ${((width * height * 4 * picked.length) / 1e6).toFixed(0)} MB if all held at once`);
  console.log(`Target : ${OUT_DIR}`);

  if (!apply) {
    console.log('\nDRY RUN — no files written. Re-run with --apply.');
    return;
  }

  // Rebuild from scratch so a smaller step never leaves stale higher-numbered
  // frames behind for the client to request.
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  let outBytes = 0;
  for (let n = 0; n < picked.length; n++) {
    const from = path.join(SRC_DIR, source[picked[n]]);
    const to = path.join(OUT_DIR, frameName(n + 1));
    await sharp(from).resize(width, height, { fit: 'fill' }).webp({ quality }).toFile(to);
    outBytes += fs.statSync(to).size;
  }

  console.log(`\nWrote ${picked.length} frames, ${(outBytes / 1e6).toFixed(2)} MB total (${Math.round(outBytes / picked.length / 1024)} KB avg)`);
  console.log(`Reduction: ${(srcBytes / 1e6).toFixed(2)} MB -> ${(outBytes / 1e6).toFixed(2)} MB on the wire`);
  console.log(`\nSet heroSequenceMobile.count = ${picked.length} in homeContent.ts`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
