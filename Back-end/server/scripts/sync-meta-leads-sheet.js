/**
 * Check, or run, the Google Sheet → Meta leads sync by hand.
 *
 *   node scripts/sync-meta-leads-sheet.js            # dry run: counts only, writes nothing
 *   node scripts/sync-meta-leads-sheet.js --apply    # save
 *
 * Prints tab names, column headings and counts — never a customer's details.
 * Run a dry run after --apply to prove it: every row should be "unchanged".
 * Needs MONGODB_URI, META_LEADS_SHEET_ID and GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON.
 *
 * Rollback: the sync only touches the metaleads collection, so
 *   db.metaleads.drop(); db.metaleadsyncstates.drop()
 * and removing META_LEADS_SHEET_ID undoes it, with the sheet untouched.
 */
import mongoose from 'mongoose';
import { syncMetaLeadsFromSheet } from '../services/metaLeadSync.js';

const apply = process.argv.includes('--apply');

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI / MONGO_URI not set');
  // autoIndex off: merely connecting must never build indexes on this cluster.
  await mongoose.connect(uri, { autoIndex: false });
  console.log(`[meta-leads] database: ${mongoose.connection.name} | ${apply ? 'APPLY' : 'DRY RUN (nothing is written)'}`);

  const { reports, totals } = await syncMetaLeadsFromSheet({ apply });
  reports.forEach((r) => {
    console.log(`\n"${r.tab}"${r.unrecognised ? '  ⚠ COLUMNS NOT RECOGNISED — NOT IMPORTED' : ''}`);
    console.log(`  rows ${r.rowsWithData} | ready ${r.ready} | test leads ${r.testLeads} | repeated Meta id ${r.repeatedMetaIds}`);
    console.log(`  phone repeated in tab ${r.repeatedPhones} | no date ${r.undated} | unreadable date ${r.unreadableDates} | no phone/e-mail ${r.noContact}`);
    console.log(`  columns: ${r.columns.join(', ')}`);
  });
  console.log('\nTOTAL', totals);
  const accounted = totals.ready + totals.testLeads + totals.repeatedMetaIds + totals.unrecognisedRows;
  console.log(accounted === totals.rowsWithData ? `Every row accounted for: ${accounted} of ${totals.rowsWithData}` : `⚠ ROWS UNACCOUNTED FOR: ${totals.rowsWithData - accounted}`);
}

main()
  .catch((err) => { console.error('[meta-leads] failed:', err.message); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
