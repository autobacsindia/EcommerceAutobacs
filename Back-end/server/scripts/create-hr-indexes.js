/**
 * Build the HR system's indexes (docs/ADR-hr-system.md). Production runs with
 * autoIndex off, so a deploy never builds them; this script does, from the
 * schemas themselves (declared == built, no hand-copied specs to drift).
 *
 * It loads EVERY model in models/hr/, so a later HR session that adds a model or
 * an index needs no edit here — just run it again after that deploy.
 *
 * All HR collections are new and empty when this first runs, so every build is
 * instant. Safe to run more than once ("already there").
 *
 * Usage (from Back-end/server; prod via `railway run`, no dotenv):
 *   node scripts/create-hr-indexes.js           # dry run
 *   node scripts/create-hr-indexes.js --apply   # build
 * Then: npm run audit-index-drift
 *
 * Rollback: drop the named `hr_*` indexes (or the empty collections) — nothing
 * outside the HR system reads them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import mongoose from 'mongoose';

const APPLY = process.argv.includes('--apply');
const TAG = '[hr-indexes]';
const HR_MODELS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../models/hr');

export async function loadHrModels(dir = HR_MODELS_DIR) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort();
  const models = [];
  for (const f of files) {
    const mod = await import(pathToFileURL(path.join(dir, f)).href);
    if (mod.default?.schema && mod.default?.collection) models.push(mod.default);
  }
  return models;
}

export async function buildIndexes({ apply = APPLY, log = console.log, models } = {}) {
  const list = models || await loadHrModels();
  const out = [];
  for (const Model of list) {
    const coll = Model.collection;
    const existing = new Set((await coll.indexes().catch(() => [])).map((i) => i.name));
    for (const [keys, options] of Model.schema.indexes()) {
      const { name } = options;
      if (!name) throw new Error(`${Model.modelName}: every index must be named`);
      let state;
      if (existing.has(name)) state = 'already there';
      else if (apply) {
        await coll.createIndex(keys, options);
        state = 'built';
      } else state = 'would build';
      out.push([`${coll.collectionName}.${name}`, state]);
    }
  }
  for (const [name, state] of out) log(`${TAG} ${name}: ${state}`);
  return out;
}

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI / MONGO_URI not set');
  // autoIndex off: importing the models must not build every declared index.
  await mongoose.connect(uri, { autoIndex: false });
  console.log(`${TAG} ${APPLY ? 'APPLY' : 'DRY RUN (add --apply to build)'}`);
  await buildIndexes();
  await mongoose.disconnect();
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch(async (err) => {
    console.error(`${TAG} failed:`, err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}
