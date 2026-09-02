/**
 * Runtime entry point for the careers media retention sweep (the cron calls
 * this; the CLI script in scripts/ is the manual equivalent).
 *
 * Kept separate from cronService so the destructive dependencies — Cloudinary
 * and the JobApplication model — are imported lazily at run time rather than at
 * module load. cronService is imported by app.js on every boot, including in
 * tests; pulling the delete path into that graph would put a live Cloudinary
 * client in every test process.
 */
import JobApplication from '../models/JobApplication.js';
import { deleteCareersAssetAnywhere } from './storage/careersAssetStore.js';
import {
  DEFAULT_RETENTION_DAYS, selectDue, purgeApplicationMedia, summarise,
} from './careersRetentionService.js';

/**
 * Routed by the stored ref's own `provider`, so this sweep keeps working across
 * the cutover in both directions. `not_found` counts as success — see the CLI
 * script for the reasoning.
 */
const deleteAsset = ({ publicId, resourceType, provider }) =>
  deleteCareersAssetAnywhere({ publicId, resourceType, provider });

/**
 * Run one sweep. Returns a summary; never throws for an individual failure.
 *
 * The tripwire is intentionally duplicated from the CLI rather than shared: an
 * unattended job that suddenly matches hundreds of applications is a symptom of
 * a bug (a status migration, a clock error), and the right response is to stop
 * and alert rather than to erase at scale on a timer.
 */
export const runCareersMediaRetention = async ({
  retentionDays = Number(process.env.CAREERS_MEDIA_RETENTION_DAYS || DEFAULT_RETENTION_DAYS),
  max = Number(process.env.CAREERS_MEDIA_RETENTION_MAX || 200),
} = {}) => {
  const rejected = await JobApplication.find({ status: 'rejected' }).lean();
  const due = selectDue(rejected, { retentionDays });
  if (!due.length) return { purged: 0, wouldPurge: 0, partial: 0, files: 0, bytes: 0 };

  if (due.length > max) {
    console.error(`[CareersRetention] ABORT: ${due.length} applications due exceeds max ${max} — not deleting. Investigate.`);
    return { aborted: true, due: due.length };
  }

  const persist = (id, patch) => JobApplication.updateOne({ _id: id }, { $set: patch });
  const rows = [];
  for (const a of due) {
    rows.push(await purgeApplicationMedia(a, { deleteAsset, persist, apply: true }));
  }
  const s = summarise(rows);
  console.log(`[CareersRetention] purged ${s.purged} application(s), ${s.files} file(s), ${(s.bytes / 1048576).toFixed(1)} MB` +
    (s.partial ? ` | ${s.partial} partial (will retry)` : ''));
  return s;
};

export default { runCareersMediaRetention };
