/**
 * One-off migration: merge the mis-cased blog category "tips and tricks" into
 * the canonical "Tips & Tricks", collapsing the duplicate filter chip.
 *
 * Idempotent (re-running is a no-op once merged) and fully logged.
 *
 *   Dry-run (default):  node --import=dotenv/config scripts/merge-tips-tricks-category.js
 *   Apply:              node --import=dotenv/config scripts/merge-tips-tricks-category.js --apply
 */
import mongoose from "mongoose";

const FROM = "tips and tricks"; // exact string to retire
const TO = "Tips & Tricks"; // canonical
const APPLY = process.argv.includes("--apply");

const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!uri) {
  console.error("No MONGO_URI / MONGODB_URI in env.");
  process.exit(1);
}
console.log("DB:", uri.replace(/\/\/[^@]*@/, "//<redacted>@"));
console.log("Mode:", APPLY ? "APPLY (writing)" : "DRY-RUN (no writes)");

await mongoose.connect(uri);
const col = mongoose.connection.collection("articles");

// Exact-match only — we deliberately do NOT touch other casings/categories.
const filter = { category: FROM };
const targets = await col
  .find(filter, { projection: { title: 1, slug: 1, type: 1, status: 1 } })
  .toArray();

console.log(`\nArticles with category === ${JSON.stringify(FROM)}: ${targets.length}`);
for (const a of targets) {
  console.log(`  [${a.type}/${a.status}] ${a._id}  ${a.slug}`);
}

if (!targets.length) {
  console.log("\nNothing to merge — already clean.");
} else if (!APPLY) {
  console.log(`\nDRY-RUN: would set category → ${JSON.stringify(TO)} on the above.`);
  console.log("Re-run with --apply to perform the update.");
} else {
  const res = await col.updateMany(filter, { $set: { category: TO } });
  console.log(`\nUpdated ${res.modifiedCount} article(s) → category ${JSON.stringify(TO)}.`);
}

// Post-state (or current state in dry-run) for confirmation.
const after = await col
  .aggregate([
    { $match: { type: "blog", status: "published" } },
    { $group: { _id: "$category", count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ])
  .toArray();
console.log("\n=== published blog categories now ===");
for (const r of after) console.log(`  ${JSON.stringify(r._id)} → ${r.count}`);

await mongoose.disconnect();
console.log("\nDone.");
