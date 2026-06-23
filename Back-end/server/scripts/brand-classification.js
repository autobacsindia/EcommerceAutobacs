// READ-ONLY: lists every distinct product `brand` value with its product count and a
// proposed action — KEEP (real parts brand), REMOVE (vehicle make), or REVIEW (looks like
// a vehicle model or is ambiguous). For human review before any cleanup is applied.
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Vehicle MAKES — confident REMOVE (these are car brands, not parts brands).
const MAKES = new Set([
  'toyota', 'mahindra', 'isuzu', 'ford', 'jeep', 'maruti', 'suzuki', 'maruti suzuki',
  'volkswagen', 'vw', 'hyundai', 'kia', 'audi', 'bmw', 'mercedes', 'mercedes benz', 'benz',
  'land rover', 'range rover', 'nissan', 'renault', 'tata', 'honda', 'skoda', 'mg',
  'datsun', 'fiat', 'mitsubishi', 'chevrolet', 'force', 'citroen', 'jaguar', 'volvo',
  'lexus', 'porsche', 'mini',
].map(norm));

// Vehicle MODELS — REVIEW (a model in the brand field is also wrong, but flag for a human).
const MODELS = new Set([
  'thar', 'thar roxx', 'scorpio', 'scorpio n', 'bolero', 'xuv', 'xuv700', 'xuv300', 'xuv400',
  'fortuner', 'hilux', 'innova', 'innova crysta', 'crysta', 'land cruiser', 'prado', 'rush',
  'd max', 'dmax', 'v cross', 'vcross', 'mu x', 'mux', 'endeavour', 'ecosport', 'ranger',
  'wrangler', 'compass', 'meridian', 'jimny', 'brezza', 'creta', 'venue', 'tucson', 'seltos',
  'sonet', 'carens', 'defender', 'discovery', 'gurkha', 'duster',
].map(norm));

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const Product = (await import('../models/Product.js')).default;

  const rows = await Product.aggregate([
    { $match: { isActive: true, brand: { $nin: [null, ''] } } },
    { $group: { _id: '$brand', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);

  const classify = (brand) => {
    const n = norm(brand);
    if (MAKES.has(n)) return 'REMOVE';
    if (MODELS.has(n)) return 'REVIEW';
    return 'KEEP';
  };

  const out = rows.map((r) => ({ brand: r._id, count: r.count, action: classify(r._id) }));
  const tot = (a) => out.filter((x) => x.action === a).reduce((s, x) => s + x.count, 0);

  const noBrand = await Product.countDocuments({ isActive: true, $or: [{ brand: null }, { brand: '' }, { brand: { $exists: false } }] });

  console.log(`\nDistinct brand values: ${out.length} | active products with a brand: ${out.reduce((s, x) => s + x.count, 0)} | products with NO brand: ${noBrand}\n`);
  console.log('ACTION  | products | brand');
  console.log('--------|----------|------------------------------------');
  for (const x of out) {
    console.log(`${x.action.padEnd(7)} | ${String(x.count).padStart(8)} | ${x.brand}`);
  }
  console.log(`\nSummary: REMOVE ${out.filter(x=>x.action==='REMOVE').length} values / ${tot('REMOVE')} products`);
  console.log(`         REVIEW ${out.filter(x=>x.action==='REVIEW').length} values / ${tot('REVIEW')} products`);
  console.log(`         KEEP   ${out.filter(x=>x.action==='KEEP').length} values / ${tot('KEEP')} products`);

  await mongoose.disconnect();
}

main().catch(async (e) => { console.error(e); await mongoose.disconnect(); process.exit(1); });
