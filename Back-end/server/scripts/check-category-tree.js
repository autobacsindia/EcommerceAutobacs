// READ-ONLY diagnostic: audits the category hierarchy and product distribution.
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const Category = (await import('../models/Category.js')).default;
  const Product = (await import('../models/Product.js')).default;

  const cats = await Category.find({}).select('name slug parent isActive').lean();
  const byId = new Map(cats.map(c => [String(c._id), c]));

  // Duplicate normalized names.
  const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const groups = new Map();
  for (const c of cats) {
    const k = norm(c.name);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  const dupes = [...groups.values()].filter(g => g.length > 1);

  // Product membership.
  const counts = await Product.aggregate([
    { $match: { isActive: true } },
    { $unwind: '$categories' },
    { $group: { _id: '$categories', n: { $sum: 1 } } },
  ]);
  const directCount = new Map(counts.map(r => [String(r._id), r.n]));

  const subtreeIds = (rootSlug) => {
    const root = cats.find(c => c.slug === rootSlug);
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

  console.log(`Total categories: ${cats.length}  active: ${cats.filter(c=>c.isActive).length}`);
  console.log(`Top-level: ${cats.filter(c=>!c.parent).length}`);
  console.log(`Duplicate normalized-name groups: ${dupes.length}`);
  dupes.slice(0, 40).forEach(g => console.log(`  • ${g.map(c=>c.slug).join('  |  ')}`));

  for (const hub of ['lighting', 'audio']) {
    const ids = subtreeIds(hub);
    let total = 0; ids.forEach(id => total += directCount.get(id) || 0);
    console.log(`\nHUB "${hub}": ${ids.size} categories in subtree, ${total} products (aggregated).`);
  }

  // Light/audio categories NOT in the respective hub.
  const lightIds = subtreeIds('lighting');
  const audioIds = subtreeIds('audio');
  const brandIds = subtreeIds('brands');
  const lightRe = /light|lamp|\bled\b|headlight|taillight|drl|fog/i;
  const audioRe = /audio|speaker|stereo|sound|subwoofer|amplifier|head unit|android (screen|car stereo)/i;

  const orphanLights = cats.filter(c =>
    lightRe.test(c.name) && !lightIds.has(String(c._id)) && !brandIds.has(String(c._id))
  );
  const orphanAudio = cats.filter(c =>
    audioRe.test(c.name) && !audioIds.has(String(c._id)) && !brandIds.has(String(c._id))
  );

  console.log(`\nLIGHT-named categories OUTSIDE the Lighting hub: ${orphanLights.length}`);
  orphanLights.forEach(c => console.log(`  - ${c.name} (${c.slug})  parent=${c.parent ? (byId.get(String(c.parent))?.name || '?') : 'TOP'}  products=${directCount.get(String(c._id))||0}`));
  console.log(`\nAUDIO-named categories OUTSIDE the Audio hub: ${orphanAudio.length}`);
  orphanAudio.forEach(c => console.log(`  - ${c.name} (${c.slug})  parent=${c.parent ? (byId.get(String(c.parent))?.name || '?') : 'TOP'}  products=${directCount.get(String(c._id))||0}`));

  await mongoose.disconnect();
}

main().catch(async (e) => { console.error(e); await mongoose.disconnect(); process.exit(1); });
