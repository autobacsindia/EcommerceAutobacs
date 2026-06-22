// Re-parent the category sprawl into the canonical 2-level taxonomy using auto-parts
// SEMANTIC KEYWORD RULES (the migration's leaf->hub map proved too noisy to trust).
//
//   node scripts/reparent-to-canonical.js          # DRY RUN + writes a review CSV
//   node scripts/reparent-to-canonical.js --apply    # applies the moves
//
// Behaviour:
//  - Promotes the canonical hubs to top-level (e.g. Body Kits) so they can host leaves.
//  - For each non-hub active category (excluding the Brands subtree), matches its
//    name/slug against ordered rules (first match wins) to pick a hub; proposes a move
//    only when that hub differs from the current parent. Unmatched categories are left
//    as-is and reported. Always writes scripts/reparent-proposal.csv for review.
//  - Idempotent; refreshes the category cache on apply.
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const APPLY = process.argv.includes('--apply');

// Canonical hubs that must be top-level to host subcategories.
const HUB_SLUGS = [
  'accessories', 'exterior', 'interior', 'performance', 'suspension', 'lighting',
  'body-kits', 'protection-kit', 'roof-top', 'audio', 'portable-fridge', 'winch',
  'x-jack', 'other', 'brakes',
];

// Hubs that may need to be created if absent (added post-migration).
const HUBS_TO_ENSURE = [{ name: 'Brakes', slug: 'brakes' }];

// Ordered keyword rules: first match wins. Strong/specific signals first.
// `\w*` is used on long, unambiguous tokens so plurals/suffixes match
// (light→lighting/lights, coil→coilovers, mirror→mirrors). Short or risky tokens
// (mat, led, hid, fog) stay bounded to avoid false hits (e.g. "mat" in "autoMATic").
const RULES = [
  // Lighting BEFORE brakes so "brake light" (a lamp) classifies as Lighting, not Brakes.
  ['lighting',       /\b(light\w*|lamp\w*|\bled\b|headlight\w*|tail\s*light\w*|taillight\w*|drl|\bfog\b|beacon\w*|bulb\w*|light\s*bar|projector\w*|\bhid\b|marker\w*|pod\s*light\w*|number\s*plate\s*light)\b/],
  ['brakes',         /\b(brake\w*|braking|caliper\w*|rotor\w*|brake\s*pad\w*|brake\s*disc\w*|brake\s*line\w*)\b/],
  ['suspension',     /\b(shock\w*|absorber\w*|spring\w*|coil\w*|strut\w*|suspension\w*|lift\s*kit|leveling|levelling|lowering|sway\s*bar|control\s*arm\w*|damper\w*|leaf\s*spring|torsion|helper\s*spring|balance\s*arm\w*|air\s*suspension|differential\s*drop)\b/],
  ['audio',          /\b(audio\w*|speaker\w*|stereo\w*|subwoofer\w*|amplifier\w*|sound\s*system|head\s*unit|infotainment\w*|android\s*(screen|car\s*stereo)|tweeter\w*|car\s*play|\bdsp\b)\b/],
  ['performance',    /\b(exhaust\w*|intake\w*|turbo\w*|intercooler\w*|\becu\b|downpipe\w*|down\s*pipe|muffler\w*|header\w*|snorkel\w*|air\s*filter\w*|cold\s*air|valvetronic\w*|throttle\s*controller\w*)\b/],
  ['roof-top',       /\b(roof\w*|rack\w*|carrier\w*|basket\w*|tent\w*|awning\w*|canop\w*|ladder\w*|cross\s*bar\w*|crossbar\w*|luggage|cargo\w*|bed\s*rack|bed\s*liner|tonneau\w*|load\s*bar|reco-?traks?|tri-?fold|soft\s*cover|roller\s*shutter)\b/],
  ['protection-kit', /\b(skid\w*|bash\w*|underbody|under\s*body|armou?r\w*|scuff\w*|rock\s*slider\w*|diff\s*guard\w*|tank\s*guard\w*|ppf|paint\s*protection|sill\s*guard\w*|protection\s*plate|protector\w*|bull\s*bar\w*|bullbar\w*|roll\s*bar\w*|roll\s*cage\w*|sports\s*bar\w*|loop\s*bar\w*|nudge\s*bar\w*)\b/],
  ['interior',       /\b(mats?\b|console\w*|dashboard\w*|\bdash\b|seat\w*|armrest\w*|climate\w*|gear\s*knob|steering\w*|pedal\w*|cabin\w*|cup\s*holder|sun\s*shade|headliner\w*|upholstery|door\s*pad|floor\w*|crystal\w*|meter\w*|neck\s*rest|grab\s*handle\w*|switch\s*panel\w*|cluster\w*|\bhud\b)\b/],
  ['body-kits',      /\b(body\s*kit\w*|bodykit\w*|wide\s*body|conversion\s*kit|facelift\w*|lip\s*kit|skirting\w*|skirt\s*kit)\b/],
  ['exterior',       /\b(bumper\w*|fender\w*|flare\w*|spoiler\w*|grill\w*|grille\w*|bonnet\w*|hood\w*|visor\w*|mirror\w*|side\s*step\w*|running\s*board\w*|foot\s*step\w*|mud\s*guard\w*|mudguard\w*|mud\s*flap\w*|wheel\s*arch\w*|garnish\w*|chrome|emblem\w*|badge\w*|antenna\w*|wiper\w*|scoop\w*|splitter\w*|diffuser\w*|skirt\w*|nudge|overfender\w*|over\s*fender\w*|cladding\w*|door\s*handle\w*|tailgate\w*|window\w*|\blip\b)\b/],
  ['winch',          /\b(winch\w*)\b/],
  ['portable-fridge',/\b(fridge\w*|refrigerator\w*|cooler\w*|freezer\w*)\b/],
  ['accessories',    /\b(dash\s*cam\w*|camera\w*|charger\w*|battery\w*|batteries|compressor\w*|jump\s*starter\w*|key\s*case|smart\s*key|alarm\w*|security|recover\w*|jerry\s*can|storage|organizer\w*|\btool\w*|snatch\w*|shackle\w*|shovel\w*|tyre\s*deflator\w*|tyre\s*repair|deflator\w*|walkie|power\s*bank|snow\s*chain\w*|wheel\s*lock\w*|wheel\s*spacer\w*|spare\s*tire\w*|traction\w*)\b/],
];

function classify(text) {
  for (const [hub, re] of RULES) if (re.test(text)) return hub;
  return null;
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const Category = (await import('../models/Category.js')).default;
  const categoryMappingService = (await import('../services/categoryMappingService.js')).default;

  const cats = await Category.find({ isActive: true }).select('name slug parent').lean();
  const bySlug = new Map(cats.map(c => [c.slug, c]));
  const byId = new Map(cats.map(c => [String(c._id), c]));

  // Ensure post-migration hubs (e.g. Brakes) exist.
  for (const h of HUBS_TO_ENSURE) {
    if (bySlug.has(h.slug)) continue;
    if (APPLY) {
      const created = (await Category.create({ name: h.name, slug: h.slug, isActive: true, parent: null })).toObject();
      bySlug.set(h.slug, created);
      cats.push(created);
      console.log(`  + created hub "${h.name}" (${h.slug})`);
    } else {
      const synthetic = { _id: `NEW:${h.slug}`, name: h.name, slug: h.slug, parent: null };
      bySlug.set(h.slug, synthetic);
      console.log(`  (dry run) would create hub "${h.name}" (${h.slug})`);
    }
  }

  // Resolve hubs + promote any non-top-level hub.
  const hubBySlug = new Map();
  const promotions = [];
  for (const slug of HUB_SLUGS) {
    const hub = bySlug.get(slug);
    if (!hub) { console.log(`  (warn) hub missing: ${slug}`); continue; }
    hubBySlug.set(slug, hub);
    if (hub.parent) promotions.push(hub);
  }
  const hubIds = new Set([...hubBySlug.values()].map(h => String(h._id)));

  // Brands subtree to skip (collapse handled separately).
  const brandsRoot = bySlug.get('brands') || cats.find(c => c.name.toLowerCase() === 'brands');
  const brandSubtree = new Set();
  if (brandsRoot) {
    brandSubtree.add(String(brandsRoot._id));
    let added = true;
    while (added) {
      added = false;
      for (const c of cats) {
        const p = c.parent ? String(c.parent) : null;
        if (p && brandSubtree.has(p) && !brandSubtree.has(String(c._id))) { brandSubtree.add(String(c._id)); added = true; }
      }
    }
  }

  const rows = [];      // every considered category (for CSV)
  const moves = [];     // {cat, hub}
  for (const c of cats) {
    const id = String(c._id);
    if (hubIds.has(id)) continue;
    if (brandSubtree.has(id)) continue;

    const hubSlug = classify(`${c.name} ${c.slug}`.toLowerCase());
    const currentParentName = c.parent ? (byId.get(String(c.parent))?.name || '?') : 'TOP';
    let action, proposed = '';
    if (!hubSlug) {
      action = 'unclassified';
    } else {
      const hub = hubBySlug.get(hubSlug);
      proposed = hub.name;
      if (String(c.parent) === String(hub._id)) action = 'keep';
      else { action = 'move'; moves.push({ cat: c, hub }); }
    }
    rows.push({ slug: c.slug, name: c.name, current: currentParentName, proposed, action });
  }

  // CSV report
  const csvPath = path.join(__dirname, 'reparent-proposal.csv');
  const esc = s => `"${String(s).replace(/"/g, '""')}"`;
  const csv = ['slug,name,current_parent,proposed_hub,action']
    .concat(rows.sort((a, b) => a.action.localeCompare(b.action) || a.proposed.localeCompare(b.proposed))
      .map(r => [r.slug, r.name, r.current, r.proposed, r.action].map(esc).join(',')))
    .join('\n');
  fs.writeFileSync(csvPath, csv);

  // Summary
  const byHub = {};
  moves.forEach(m => { byHub[m.hub.name] = (byHub[m.hub.name] || 0) + 1; });
  console.log(`\n=== SEMANTIC RE-PARENT (${APPLY ? 'APPLY' : 'DRY RUN'}) ===`);
  if (promotions.length) console.log(`Hub promotions to top-level: ${promotions.map(h => h.slug).join(', ')}`);
  console.log(`Moves: ${moves.length}  |  keep: ${rows.filter(r => r.action === 'keep').length}  |  unclassified: ${rows.filter(r => r.action === 'unclassified').length}`);
  console.log('Moves by hub:'); Object.entries(byHub).sort((a, b) => b[1] - a[1]).forEach(([h, n]) => console.log(`  ${h}: ${n}`));
  console.log(`\nReview CSV written: ${csvPath}`);
  console.log(`Unclassified (left as-is): ${rows.filter(r => r.action === 'unclassified').map(r => r.slug).join(', ') || 'none'}`);

  if (APPLY) {
    for (const h of promotions) await Category.updateOne({ _id: h._id }, { $set: { parent: null } });
    for (const m of moves) await Category.updateOne({ _id: m.cat._id }, { $set: { parent: m.hub._id } });
    categoryMappingService.refresh();
    console.log(`\n✓ Applied ${promotions.length} promotion(s) + ${moves.length} move(s).`);
  } else {
    console.log('\n(dry run — review the CSV, then re-run with --apply)');
  }

  await mongoose.disconnect();
}

main().catch(async (e) => { console.error(e); await mongoose.disconnect(); process.exit(1); });
