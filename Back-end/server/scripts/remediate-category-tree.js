// Category-tree remediation (post-WooCommerce-migration).
//
//   node scripts/remediate-category-tree.js          # DRY RUN (default) — prints plan, no writes
//   node scripts/remediate-category-tree.js --apply  # applies re-parenting (audio + light strays)
//
// Duplicate pairs are ALWAYS report-only (never written) — merging is reviewed separately.
// Idempotent: re-running skips categories already correctly parented.
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const APPLY = process.argv.includes('--apply');

// Explicit, reviewed list of light strays to move under Lighting.
// Deliberately EXCLUDES generic-driving-light-wiring-harness (an accessory) and
// rear-view-mirrors-with-led (a mirror).
const LIGHT_STRAY_SLUGS = [
  'brake-light',
  'connecting-center-light',
  'driving-light-protective-covers',
  'hood-light-bug-visor',
  'light-mount-clamp',
  'motor-vehicle-lighting',
  'roof-light-bar',
  'roof-light-2',
];

// Audio orphans detected by name; brands excluded. Re-parented under Audio.
const AUDIO_RE = /audio|speaker|stereo|sound|subwoofer|amplifier|head unit|tweeter|infotainment|android (screen|car stereo)/i;

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const Category = (await import('../models/Category.js')).default;
  const Product = (await import('../models/Product.js')).default;

  const cats = await Category.find({}).select('name slug parent isActive').lean();
  const bySlug = new Map(cats.map(c => [c.slug, c]));
  const byId = new Map(cats.map(c => [String(c._id), c]));

  const counts = await Product.aggregate([
    { $match: { isActive: true } },
    { $unwind: '$categories' },
    { $group: { _id: '$categories', n: { $sum: 1 } } },
  ]);
  const directCount = new Map(counts.map(r => [String(r._id), r.n]));

  const subtreeIds = (rootSlug) => {
    const root = bySlug.get(rootSlug);
    if (!root) return new Set();
    const ids = new Set([String(root._id)]);
    let added = true;
    while (added) {
      added = false;
      for (const c of cats) {
        const p = c.parent ? String(c.parent) : null;
        if (p && ids.has(p) && !ids.has(String(c._id))) { ids.add(String(c._id)); added = true; }
      }
    }
    return ids;
  };

  const lighting = bySlug.get('lighting');
  const audio = bySlug.get('audio');
  if (!lighting) throw new Error('Lighting hub (slug "lighting") not found.');
  if (!audio) throw new Error('Audio hub (slug "audio") not found.');

  const brandIds = subtreeIds('brands');
  const audioIds = subtreeIds('audio');

  const moves = []; // { cat, toName, toId }

  // 1) Light strays -> Lighting
  for (const slug of LIGHT_STRAY_SLUGS) {
    const c = bySlug.get(slug);
    if (!c) { console.log(`  (skip) light stray slug not found: ${slug}`); continue; }
    if (String(c.parent) === String(lighting._id)) continue; // already correct
    moves.push({ cat: c, toName: lighting.name, toId: lighting._id });
  }

  // 2) Audio orphans -> Audio
  for (const c of cats) {
    if (!AUDIO_RE.test(c.name)) continue;
    if (audioIds.has(String(c._id))) continue;        // already under Audio (or is Audio)
    if (brandIds.has(String(c._id))) continue;        // brand category, leave
    moves.push({ cat: c, toName: audio.name, toId: audio._id });
  }

  console.log(`\n=== RE-PARENTING PLAN (${APPLY ? 'APPLY' : 'DRY RUN'}) ===`);
  if (moves.length === 0) {
    console.log('  Nothing to do — tree already remediated.');
  }
  for (const m of moves) {
    const from = m.cat.parent ? (byId.get(String(m.cat.parent))?.name || '?') : 'TOP-LEVEL';
    console.log(`  ${m.cat.name} (${m.cat.slug})  [${directCount.get(String(m.cat._id)) || 0} prods]  ${from} -> ${m.toName}`);
  }

  if (APPLY && moves.length) {
    for (const m of moves) {
      await Category.updateOne({ _id: m.cat._id }, { $set: { parent: m.toId } });
    }
    console.log(`\n✓ Applied ${moves.length} re-parenting update(s).`);
  } else if (moves.length) {
    console.log('\n(dry run — re-run with --apply to write)');
  }

  // 3) Duplicate pairs — REPORT ONLY.
  const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const groups = new Map();
  for (const c of cats) {
    const k = norm(c.name);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  const dupes = [...groups.values()].filter(g => g.length > 1);
  console.log(`\n=== DUPLICATE MERGE PLAN (report only, ${dupes.length} pairs) ===`);
  console.log('  Proposed keeper = non-suffixed / shorter slug. Move products from dup -> keeper, then soft-delete dup.');
  for (const g of dupes) {
    const sorted = [...g].sort((a, b) => a.slug.length - b.slug.length || a.slug.localeCompare(b.slug));
    const keeper = sorted[0];
    const drop = sorted.slice(1);
    const fmt = c => `${c.slug}[${directCount.get(String(c._id)) || 0}]`;
    console.log(`  keep ${fmt(keeper)}  <=  ${drop.map(fmt).join(', ')}`);
  }

  await mongoose.disconnect();
}

main().catch(async (e) => { console.error(e); await mongoose.disconnect(); process.exit(1); });
