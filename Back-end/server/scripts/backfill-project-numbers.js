/**
 * Give every existing project its ID (PRJ-0001 …), oldest first.
 *
 * Projects created after this ships are numbered when they are made; this is
 * for the ones from before. Run it right after the deploy, so the old projects
 * take the low numbers. Safe to run again: it only touches projects with no ID.
 *
 * Usage (in Back-end/server):
 *   node scripts/backfill-project-numbers.js                 # dry run, changes nothing
 *   node scripts/backfill-project-numbers.js --apply         # set the IDs
 *   node scripts/backfill-project-numbers.js --rollback      # dry run of the undo
 *   node scripts/backfill-project-numbers.js --rollback --apply
 *
 * ROLLBACK: --rollback --apply removes only the IDs this script set. Do it before
 * anyone links a payment to one of them — a payment keeps the code it was linked
 * with ("PRJ-0003") either way, but the project would no longer answer to it.
 *
 * Production: `railway run node scripts/backfill-project-numbers.js` from a folder
 * with no .env, after the owner's OK.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import StaffProject from '../models/StaffProject.js';
import Counter from '../models/Counter.js';
import { backfillProjectNumbers, rollbackProjectNumbers } from './lib/backfillProjectNumbers.js';

dotenv.config();

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const log = (line) => console.log(line);

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI (or MONGO_URI) not set in environment.');
  // autoIndex off: connecting must never build indexes on whatever cluster this points at.
  await mongoose.connect(uri, { autoIndex: false });
  console.log(`${apply ? 'APPLY' : 'DRY RUN'} on ${mongoose.connection.host}/${mongoose.connection.name}`);
  if (args.has('--rollback')) {
    await rollbackProjectNumbers({ StaffProject }, { apply, log });
  } else {
    const { numbered } = await backfillProjectNumbers({ StaffProject, Counter }, { apply, log });
    if (apply && numbered.length) console.log('Undo with: node scripts/backfill-project-numbers.js --rollback --apply');
  }
  if (!apply) console.log('Nothing was changed. Re-run with --apply.');
}

main()
  .catch((err) => { console.error(err.message); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
