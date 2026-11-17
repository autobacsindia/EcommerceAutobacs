import { PROJECT_COUNTER, projectCode } from '../../models/StaffProject.js';

/**
 * Give every project from before project IDs its number (PRJ-0001 …), oldest
 * first. New projects are numbered when created (models/StaffProject.js), so
 * this only ever touches rows with no number, and is safe to run again.
 *
 * Writes go through the raw collection: `number` is immutable on the model.
 * Each row is a compare-and-set on "still has no number", so two runs at once
 * cannot number one project twice — the loser's number is a gap, never a clash.
 *
 * `numberBackfilledAt` marks the rows this set, which is what --rollback undoes.
 *
 * @param {{ StaffProject, Counter }} models
 * @param {{ apply?: boolean, log?: (line: string) => void }} opts
 * @returns {Promise<{ missing: number, numbered: Array<{ id: string, name: string, code: string }> }>}
 */
export async function backfillProjectNumbers({ StaffProject, Counter }, { apply = false, log = () => {} } = {}) {
  const missing = await StaffProject.collection
    .find({ number: { $not: { $type: 'number' } } }, { projection: { _id: 1, name: 1, createdAt: 1 } })
    .sort({ createdAt: 1, _id: 1 })
    .toArray();
  const counter = await Counter.findById(PROJECT_COUNTER).lean();
  const from = (counter?.seq || 0) + 1;
  log(`${missing.length} project(s) without an ID. Counter '${PROJECT_COUNTER}' is at ${counter?.seq || 0}.`);

  const numbered = [];
  for (let i = 0; i < missing.length; i += 1) {
    const p = missing[i];
    let number = from + i;
    if (apply) {
      number = await Counter.next(PROJECT_COUNTER);
      const res = await StaffProject.collection.updateOne(
        { _id: p._id, number: { $not: { $type: 'number' } } },
        { $set: { number, numberBackfilledAt: new Date() } },
      );
      if (res.modifiedCount !== 1) { log(`  skipped ${p._id} — numbered by someone else meanwhile`); continue; }
    }
    numbered.push({ id: String(p._id), name: p.name || '', code: projectCode(number) });
    log(`  ${apply ? 'set' : 'would set'} ${projectCode(number)}  ${p._id}`);
  }
  return { missing: missing.length, numbered };
}

/** Undo: remove the numbers this script set (never the ones given at create). */
export async function rollbackProjectNumbers({ StaffProject }, { apply = false, log = () => {} } = {}) {
  const filter = { numberBackfilledAt: { $type: 'date' } };
  const count = await StaffProject.collection.countDocuments(filter);
  log(`${count} project(s) numbered by the backfill.`);
  if (apply && count) await StaffProject.collection.updateMany(filter, { $unset: { number: '', numberBackfilledAt: '' } });
  return { count };
}
