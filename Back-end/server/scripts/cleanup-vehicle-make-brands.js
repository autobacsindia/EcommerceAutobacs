// Blank the product `brand` field where it holds a VEHICLE MAKE instead of a real parts
// brand (reviewed + approved list). The vehicle name stays in the product NAME, so the
// fitment signal is preserved for later. Clears brand + brandSlug.
//
//   node scripts/cleanup-vehicle-make-brands.js          # DRY RUN
//   node scripts/cleanup-vehicle-make-brands.js --apply    # writes
//
// Idempotent; invalidates the product cache on apply.
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const APPLY = process.argv.includes('--apply');
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Reviewed + user-approved REMOVE list (18 makes + Lamborghini, Mini Cooper, AMG).
const REMOVE = new Set([
  'toyota', 'mahindra', 'bmw', 'ford', 'isuzu', 'suzuki', 'land rover', 'mercedes benz',
  'volkswagen', 'hyundai', 'jeep', 'honda', 'audi', 'kia', 'mitsubishi', 'porsche', 'volvo',
  'skoda', 'lamborghini', 'mini cooper', 'amg',
].map(norm));

// Exact-string brand renames (case fixes / dup folds). Approved: lowercase "auxbeam" -> "Auxbeam".
const RENAMES = [{ from: 'auxbeam', to: 'Auxbeam', slug: 'auxbeam' }];

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const Product = (await import('../models/Product.js')).default;

  // Distinct brands present, so we match the exact stored strings that normalize into REMOVE.
  const rows = await Product.aggregate([
    { $match: { brand: { $nin: [null, ''] } } },
    { $group: { _id: '$brand', count: { $sum: 1 } } },
  ]);
  const targets = rows.filter((r) => REMOVE.has(norm(r._id)));
  const targetValues = targets.map((t) => t._id);
  const totalProducts = targets.reduce((s, t) => s + t.count, 0);

  console.log(`\n=== BLANK VEHICLE-MAKE BRANDS (${APPLY ? 'APPLY' : 'DRY RUN'}) ===`);
  console.log(`Brand values to blank: ${targets.length} | products affected: ${totalProducts}\n`);
  targets.sort((a, b) => b.count - a.count).forEach((t) => console.log(`  ${String(t.count).padStart(4)}  ${t._id}`));

  // Report renames
  for (const r of RENAMES) {
    const n = await Product.countDocuments({ brand: r.from });
    if (n > 0) console.log(`  rename: "${r.from}" -> "${r.to}" (${n} product(s))`);
  }

  if (APPLY && targetValues.length) {
    const res = await Product.updateMany(
      { brand: { $in: targetValues } },
      { $unset: { brand: '', brandSlug: '' } }
    );
    let renamed = 0;
    for (const r of RENAMES) {
      const rr = await Product.updateMany({ brand: r.from }, { $set: { brand: r.to, brandSlug: r.slug } });
      renamed += rr.modifiedCount;
    }
    console.log(`\n✓ Blanked ${res.modifiedCount} product(s); renamed ${renamed} product(s).`);
  } else if (targetValues.length) {
    console.log('\n(dry run — re-run with --apply to write)');
  } else {
    console.log('Nothing to do (already clean).');
  }

  await mongoose.disconnect();
}

main().catch(async (e) => { console.error(e); await mongoose.disconnect(); process.exit(1); });
