/**
 * Delete the media (video answers + CV) of applications rejected more than
 * RETENTION_DAYS ago. The application RECORD is kept — name, email, role,
 * decision and admin notes all survive, so a disputed outcome can still be
 * explained. Only the disproportionate part goes: a 30 MB video of someone's
 * face, held indefinitely after they were told no.
 *
 * ⚠ PERMANENT. Cloudinary backup is not enabled on this account (verified
 *   2026-09-01), so there is no recycle bin and no restore.
 *
 * Selection and delete-ordering live in services/careersRetentionService.js and
 * are unit-tested there; this file is the wiring plus the operator safety rails.
 *
 * ── The rejectedAt backfill ─────────────────────────────────────────────────
 * `rejectedAt` was added with this feature, so applications rejected before it
 * have none. `--apply` backfills them from `rejectionEmailedAt`, falling back to
 * `updatedAt`. Measured against prod those two never diverged by more than a
 * day, so no window shifts materially. The backfill only ever fills a NULL
 * field, so it is idempotent and cannot move an existing clock.
 *
 * It matters because `updatedAt` is not a retention clock: an admin editing a
 * note moves it, which would silently restart the window and keep an
 * applicant's video indefinitely. Backfilling pins the date once.
 *
 * ── Safety ──────────────────────────────────────────────────────────────────
 *   • DRY-RUN by default; needs BOTH --apply AND --yes.
 *   • Selection recomputed live; four independent guards (see isDue), any one
 *     of which spares the application. An undeterminable date KEEPS the media.
 *   • Assets are deleted BEFORE the refs are cleared, and the refs are only
 *     cleared if EVERY asset went — a partial delete leaves everything in place
 *     so the next run retries, rather than stranding a survivor no tool can find.
 *   • Tripwire: aborts above --max (default 200).
 *   • Manifest written BEFORE the first delete; no manifest, no delete.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *   cd Back-end/server
 *   node --import=dotenv/config scripts/purge-rejected-careers-media.js
 *   node --import=dotenv/config scripts/purge-rejected-careers-media.js --apply --yes
 *
 *   --retention-days=N  window after rejection (default 14)
 *   --max=N             tripwire (default 200)
 */
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { deleteCareersAssetAnywhere } from '../services/storage/careersAssetStore.js';
import {
  DEFAULT_RETENTION_DAYS, selectDue, purgeApplicationMedia, summarise, retentionClock, daysSince,
} from '../services/careersRetentionService.js';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => { const h = argv.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };

const APPLY = flag('apply');
const YES = flag('yes');
const RETENTION_DAYS = Number(opt('retention-days', DEFAULT_RETENTION_DAYS));
const MAX = Number(opt('max', 200));

const mb = (b) => (b / 1048576).toFixed(1);
const bar = (c = '─') => console.log(c.repeat(78));

/**
 * Delete one asset from whichever store holds it, routed by the stored ref's own
 * `provider` — so this script keeps working through the Cloudinary → R2 cutover
 * and after a rollback. `not_found` counts as success: the goal is "the object is
 * gone", and a retry after a crash between delete and DB-save must be able to
 * complete rather than jamming on an asset that is already deleted.
 *
 * Shared with the scheduled runner (services/careersRetentionRunner.js) on
 * purpose: a CLI purge and the cron purge deleting from different places is
 * precisely the divergence that leaves PII behind.
 */
const deleteAsset = ({ publicId, resourceType, provider }) =>
  deleteCareersAssetAnywhere({ publicId, resourceType, provider });

const main = async () => {
  // autoIndex:false — the local .env points at PROD; a bare connect() would
  // build every declared index there, including the new retention one.
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false });
  const JobApplication = (await import('../models/JobApplication.js')).default;

  bar('═');
  console.log('PURGE REJECTED CAREERS MEDIA');
  bar('═');
  console.log(`mode      : ${APPLY ? '*** APPLY — PERMANENT DELETE ***' : 'DRY RUN (deletes nothing)'}`);
  console.log(`window    : ${RETENTION_DAYS} days after rejection`);
  console.log(`tripwire  : ${MAX}`);
  console.log('kept      : application record, name, email, role, decision, admin notes');
  bar();

  // ── Backfill rejectedAt (fills NULL only; idempotent) ──────────────────────
  const needsBackfill = await JobApplication.find({
    status: 'rejected', $or: [{ rejectedAt: null }, { rejectedAt: { $exists: false } }],
  }).lean();
  if (needsBackfill.length) {
    console.log(`rejectedAt missing on ${needsBackfill.length} rejected application(s)`);
    if (APPLY && YES) {
      let n = 0;
      for (const a of needsBackfill) {
        const stamp = a.rejectionEmailedAt || a.updatedAt;
        if (!stamp) continue;
        await JobApplication.updateOne({ _id: a._id }, { $set: { rejectedAt: stamp } });
        n += 1;
      }
      console.log(`  backfilled ${n} from rejectionEmailedAt/updatedAt`);
    } else {
      console.log('  (would backfill from rejectionEmailedAt/updatedAt on --apply)');
    }
    bar();
  }

  // ── Select ─────────────────────────────────────────────────────────────────
  const rejected = await JobApplication.find({ status: 'rejected' }).lean();
  const due = selectDue(rejected, { retentionDays: RETENTION_DAYS });
  const totalBytes = due.reduce(
    (s, a) => s + ['videoOne', 'videoTwo', 'resume', 'support']
      .reduce((t, k) => t + (a.files?.[k]?.bytes || 0), 0), 0);

  console.log(`rejected applications: ${rejected.length}`);
  console.log(`DUE for media purge  : ${due.length}  (${mb(totalBytes)} MB)`);
  console.log(`spared               : ${rejected.length - due.length} (inside window, already purged, or no media)`);
  bar();

  if (!due.length) { console.log('Nothing to do.'); await mongoose.disconnect(); return; }
  if (due.length > MAX) {
    console.error(`\n✋ ABORT: ${due.length} exceeds the ${MAX} tripwire. Check before raising --max.`);
    await mongoose.disconnect(); process.exit(1);
  }

  if (!APPLY || !YES) {
    due.slice(0, 15).forEach((a) => {
      const age = Math.floor(daysSince(retentionClock(a)));
      console.log(`  ${a.fullName} <${a.email}> — rejected ${age}d ago`);
    });
    if (due.length > 15) console.log(`  … and ${due.length - 15} more`);
    console.log('\nDRY RUN — nothing deleted. Re-run with --apply --yes.');
    await mongoose.disconnect(); return;
  }

  // ── Manifest before the first delete ───────────────────────────────────────
  const dir = path.resolve('retention-reports');
  fs.mkdirSync(dir, { recursive: true });
  const manifestPath = path.join(dir, `purged-rejected-media-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
  fs.writeFileSync(manifestPath, `${due.map((a) => JSON.stringify({
    applicationId: String(a._id), applicant: a.fullName, email: a.email, role: a.roleTitle,
    rejectedAt: retentionClock(a), ageDays: Math.floor(daysSince(retentionClock(a))),
    files: ['videoOne', 'videoTwo', 'resume', 'support']
      .map((k) => a.files?.[k]?.publicId).filter(Boolean),
    plannedAt: new Date().toISOString(),
  })).join('\n')}\n`);
  if (!fs.existsSync(manifestPath) || !fs.statSync(manifestPath).size) {
    console.error('✋ ABORT: manifest could not be written. Nothing deleted.');
    await mongoose.disconnect(); process.exit(1);
  }
  console.log(`manifest written: ${manifestPath}`);

  const persist = (id, patch) => JobApplication.updateOne({ _id: id }, { $set: patch });
  const rows = [];
  for (const a of due) {
    const row = await purgeApplicationMedia(a, { deleteAsset, persist, apply: true });
    rows.push(row);
    console.log(`  ${row.status.padEnd(11)} ${row.applicant} — ${row.deleted}/${row.files.length} file(s), ${mb(row.bytes)} MB`);
  }

  const s = summarise(rows);
  bar('═');
  console.log(`purged : ${s.purged} application(s), ${s.files} file(s), ${mb(s.bytes)} MB`);
  console.log(`partial: ${s.partial}  ${s.partial ? '(refs left intact — re-run to retry)' : ''}`);
  console.log(`manifest: ${manifestPath}`);
  console.log('No restore path — Cloudinary backup is not enabled.');
  bar('═');
  await mongoose.disconnect();
};

main().catch((e) => { console.error('[Purge] fatal:', e); process.exit(1); });
