/**
 * Delete ABANDONED careers uploads — Cloudinary assets under
 * `autobacs/careers/<nonce>/` whose submission folder maps to no JobApplication.
 *
 * ⚠ PERMANENT. Cloudinary backup is NOT enabled on this account (verified
 *   2026-09-01: assets report `backup_bytes: null`, zero versions), so there is
 *   no recycle bin and no restore. Deleted means gone.
 *
 * ── What these are ──────────────────────────────────────────────────────────
 * The careers form uploads files to Cloudinary BEFORE the server validates the
 * submission, so a rejected submission (missing resume, a .jpg in the PDF slot,
 * a file with no extension) leaves its uploads stranded with no database row.
 * Because the folder nonce is minted at signature time — before the applicant
 * has submitted a name or email — these files carry NO identity: they cannot be
 * attributed to a person, a data-subject request cannot be honoured for them,
 * and the applicant cannot be contacted. They are PII with no owner.
 *
 * (The upstream defect is separate and still live; this script cleans up after
 * it, it does not fix it.)
 *
 * ── Why the set is recomputed, never read from the audit CSV ────────────────
 * The audit report is a snapshot. Between running it and running this, a
 * submission that was mid-flight can COMPLETE, at which point its files become
 * referenced by a real application and must be spared. So the delete set is
 * derived fresh here from live Mongo + live Cloudinary, and the CSV is only
 * ever a human review aid. Trusting the snapshot is how a retention sweep
 * deletes a live applicant's video.
 *
 * ── Safety ──────────────────────────────────────────────────────────────────
 *   • DRY-RUN by default. Needs BOTH --apply AND --yes.
 *   • Three independent conditions per asset, ALL required:
 *       1. no JobApplication references its publicId;
 *       2. its folder nonce maps to no JobApplication at all;
 *       3. it is older than --min-age-days (default 7).
 *   • Condition 3 protects a submission still in progress. The youngest
 *     abandoned asset observed was 3.6 days old and uploads happen at submit
 *     time (seconds), so 7 days is ~2x the observed floor and orders of
 *     magnitude beyond a real session.
 *   • Tripwire: aborts if the set exceeds --max (default 400), which catches a
 *     logic error that would otherwise sweep live applicants' files.
 *   • Writes a manifest of exactly what is deleted BEFORE deleting. If the
 *     manifest cannot be written, nothing is deleted. Ids and sizes only — the
 *     point is to stop holding the content.
 *   • Idempotent: re-running finds nothing.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *   cd Back-end/server
 *   node --import=dotenv/config scripts/purge-abandoned-careers-assets.js
 *   node --import=dotenv/config scripts/purge-abandoned-careers-assets.js --apply --yes
 *
 *   --min-age-days=N  abandonment threshold (default 7)
 *   --max=N           abort if more than N assets match (default 400)
 */
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import cloudinary from '../config/cloudinary.js';
import { listKeys, deleteObjects } from '../services/storage/r2Provider.js';
import { isR2Configured } from '../config/storage.js';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => { const h = argv.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };

const APPLY = flag('apply');
const YES = flag('yes');
const MIN_AGE_DAYS = Number(opt('min-age-days', 7));
const MAX = Number(opt('max', 400));

const SLOTS = ['videoOne', 'videoTwo', 'resume', 'support'];
const CAREERS_PREFIX = 'autobacs/careers';
/*
  Compare on the id with any trailing extension removed.

  A Cloudinary VIDEO public_id carries no extension — the format is a separate
  field — but the R2 object migrated from it does (`…/abc` → `…/abc.mp4`). An
  exact comparison therefore reports every migrated video copy as unreferenced.
  Measured against production that was 92 of 146 objects rather than the true 4,
  and only the folder-in-use guard downstream stopped them being deleted. A
  PII-deleting script must not depend on a second guard to be correct.
*/
const stem = (s) => String(s).replace(/\.[a-z0-9]{1,5}$/i, '');

const nonceOf = (p) => { const m = /^autobacs\/careers\/([^/]+)\//.exec(p || ''); return m ? m[1] : null; };
const ageDays = (d) => (Date.now() - new Date(d)) / 86400000;
const mb = (b) => (b / 1048576).toFixed(1);
const bar = (c = '─') => console.log(c.repeat(78));

const main = async () => {
  // autoIndex:false — a bare connect() would otherwise build every declared
  // index against prod, because the local .env points there.
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false });
  const JobApplication = (await import('../models/JobApplication.js')).default;

  bar('═');
  console.log('PURGE ABANDONED CAREERS UPLOADS');
  bar('═');
  console.log(`mode         : ${APPLY ? '*** APPLY — PERMANENT DELETE ***' : 'DRY RUN (deletes nothing)'}`);
  console.log(`min age      : ${MIN_AGE_DAYS} days`);
  console.log(`tripwire max : ${MAX}`);
  bar();

  // ── Live state, recomputed now ──────────────────────────────────────────────
  const apps = await JobApplication.find({}).lean();
  const referenced = new Set();
  const appNonces = new Set();
  for (const a of apps) for (const s of SLOTS) {
    const p = a.files?.[s]?.publicId;
    if (!p) continue;
    referenced.add(stem(p));
    const n = nonceOf(p); if (n) appNonces.add(n);
  }
  console.log(`applications: ${apps.length}  |  referenced assets: ${referenced.size}  |  submission folders in use: ${appNonces.size}`);

  /*
    Enumerate BOTH stores. During the migration an abandoned upload can be in
    either, and a sweep that only knows one of them lets the other accumulate
    unattributable CVs indefinitely — which is exactly how 2.98 GB of them built
    up before this script existed. The R2 side is skipped (loudly) rather than
    failing when R2 is not configured, so the script stays runnable on a
    Cloudinary-only box.
  */
  const all = [];
  for (const rt of ['image', 'video', 'raw']) {
    let next;
    do {
      const page = await cloudinary.api.resources({
        resource_type: rt, type: 'authenticated', prefix: CAREERS_PREFIX,
        max_results: 500, ...(next ? { next_cursor: next } : {}),
      }).catch(() => ({ resources: [] }));
      (page.resources || []).forEach((r) => all.push({ ...r, _rt: rt, _provider: 'cloudinary' }));
      next = page.next_cursor;
    } while (next);
  }
  const cloudinaryCount = all.length;

  /*
    ⚠ An R2 object's LastModified is when the MIGRATION copied it, not when the
    applicant uploaded it — so on its own it makes every migrated asset look
    brand new and the age gate below spares it forever. Where Cloudinary still
    holds the same asset it carries the true upload date, so we prefer that.
    (Matched on the stem: a Cloudinary video public_id has no extension, its
    migrated copy does.) An R2-native upload has no Cloudinary twin and its
    LastModified IS the upload time, which is correct.

    Where neither applies the object simply looks young and is spared. That is
    the safe direction for a script that deletes PII irreversibly: sparing costs
    storage, deleting early costs an applicant their submission.
  */
  const cloudinaryAgeByStem = new Map(all.map((r) => [stem(r.public_id), r.created_at]));

  let r2Count = 0;
  if (isR2Configured()) {
    // The private bucket — careers assets must never be anywhere else.
    const objects = await listKeys({ prefix: `${CAREERS_PREFIX}/`, scope: 'private' });
    for (const o of objects) {
      // Shape it like a Cloudinary resource so the three spare/doom conditions
      // below stay provider-agnostic; the resource type is only used for the
      // report and for Cloudinary's per-type delete API.
      const ext = (o.key.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
      all.push({
        public_id: o.key,
        bytes: o.bytes,
        created_at: cloudinaryAgeByStem.get(stem(o.key)) || o.lastModified,
        _rt: ext === 'pdf' ? 'raw' : 'video',
        _provider: 'r2',
      });
      r2Count += 1;
    }
  } else {
    console.log('⚠ R2 is not configured — the R2 side of this sweep was SKIPPED.');
  }
  console.log(`careers assets: ${cloudinaryCount} in Cloudinary + ${r2Count} in R2 = ${all.length}`);

  // ── The three conditions, all required ──────────────────────────────────────
  const doomed = [];
  const spared = { referenced: 0, folderInUse: 0, tooYoung: 0, noNonce: 0 };
  for (const r of all) {
    if (referenced.has(stem(r.public_id))) { spared.referenced++; continue; }
    const n = nonceOf(r.public_id);
    if (!n) { spared.noNonce++; continue; }           // not under a submission folder — leave alone
    if (appNonces.has(n)) { spared.folderInUse++; continue; }
    if (ageDays(r.created_at) <= MIN_AGE_DAYS) { spared.tooYoung++; continue; }
    doomed.push(r);
  }

  const bytes = doomed.reduce((s, r) => s + (r.bytes || 0), 0);
  const folders = new Set(doomed.map((r) => nonceOf(r.public_id)));
  console.log('');
  console.log(`SPARED: ${spared.referenced} referenced | ${spared.folderInUse} in a folder with an application | ${spared.tooYoung} newer than ${MIN_AGE_DAYS}d | ${spared.noNonce} outside a submission folder`);
  console.log(`TO DELETE: ${doomed.length} asset(s) in ${folders.size} folder(s), ${mb(bytes)} MB`);
  bar();

  if (!doomed.length) { console.log('Nothing to do.'); await mongoose.disconnect(); return; }

  if (doomed.length > MAX) {
    console.error(`\n✋ ABORT: ${doomed.length} exceeds the ${MAX} tripwire.`);
    console.error('   That is far more than expected — check the logic before raising --max.');
    await mongoose.disconnect();
    process.exit(1);
  }

  if (!APPLY || !YES) {
    console.log('\nDRY RUN — nothing deleted. Re-run with --apply --yes to delete permanently.');
    doomed.slice(0, 10).forEach((r) => console.log(`   would delete  ${r._provider.padEnd(10)} ${r._rt.padEnd(6)} ${mb(r.bytes).padStart(6)} MB  ${r.public_id}`));
    if (doomed.length > 10) console.log(`   … and ${doomed.length - 10} more`);
    await mongoose.disconnect();
    return;
  }

  // ── Manifest BEFORE deletion; no manifest, no delete ────────────────────────
  const dir = path.resolve('retention-reports');
  fs.mkdirSync(dir, { recursive: true });
  const manifestPath = path.join(dir, `purged-abandoned-careers-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
  const lines = doomed.map((r) => JSON.stringify({
    publicId: r.public_id, resourceType: r._rt, provider: r._provider, bytes: r.bytes,
    createdAt: r.created_at, folder: `${CAREERS_PREFIX}/${nonceOf(r.public_id)}`,
    ageDays: Math.floor(ageDays(r.created_at)), purgedAt: new Date().toISOString(),
  }));
  fs.writeFileSync(manifestPath, `${lines.join('\n')}\n`);
  if (!fs.existsSync(manifestPath) || fs.statSync(manifestPath).size === 0) {
    console.error('✋ ABORT: manifest could not be written. Nothing deleted.');
    await mongoose.disconnect();
    process.exit(1);
  }
  console.log(`manifest written: ${manifestPath}`);

  // ── Delete, per store (Cloudinary's API is per-resource_type; R2's is not) ──
  let deleted = 0; const failed = [];

  for (const rt of ['image', 'video', 'raw']) {
    const ids = doomed.filter((r) => r._provider === 'cloudinary' && r._rt === rt).map((r) => r.public_id);
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      try {
        const res = await cloudinary.api.delete_resources(chunk, { resource_type: rt, type: 'authenticated' });
        for (const [id, status] of Object.entries(res.deleted || {})) {
          if (status === 'deleted' || status === 'not_found') deleted++;
          else failed.push(`${id}: ${status}`);
        }
      } catch (err) {
        chunk.forEach((id) => failed.push(`${id}: ${err.message}`));
      }
    }
    if (ids.length) console.log(`  cloudinary/${rt}: ${ids.length} requested`);
  }

  const r2Ids = doomed.filter((r) => r._provider === 'r2').map((r) => r.public_id);
  if (r2Ids.length) {
    // deleteObjects chunks to the S3 batch limit itself and reports per-key
    // failures, which are counted rather than assumed — an S3 delete succeeds
    // for a key that was never there, so only real errors may be reported.
    const res = await deleteObjects({ keys: r2Ids, scope: 'private' });
    deleted += res.deleted;
    res.failed.forEach((k) => failed.push(`${k}: r2 delete failed`));
    console.log(`  r2/private: ${r2Ids.length} requested`);
  }

  bar('═');
  console.log(`DELETED: ${deleted} of ${doomed.length}   FAILED: ${failed.length}`);
  if (failed.length) failed.slice(0, 10).forEach((f) => console.log(`   ✗ ${f}`));
  console.log(`manifest: ${manifestPath}`);
  console.log('No restore path — Cloudinary backup is not enabled on this account, and the');
  console.log('deletes above are permanent. The manifest is the only record of what went.');
  bar('═');
  await mongoose.disconnect();
};

main().catch((e) => { console.error('[Purge] fatal:', e); process.exit(1); });
