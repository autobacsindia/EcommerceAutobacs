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

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => { const h = argv.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };

const APPLY = flag('apply');
const YES = flag('yes');
const MIN_AGE_DAYS = Number(opt('min-age-days', 7));
const MAX = Number(opt('max', 400));

const SLOTS = ['videoOne', 'videoTwo', 'resume', 'support'];
const CAREERS_PREFIX = 'autobacs/careers';
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
    referenced.add(p);
    const n = nonceOf(p); if (n) appNonces.add(n);
  }
  console.log(`applications: ${apps.length}  |  referenced assets: ${referenced.size}  |  submission folders in use: ${appNonces.size}`);

  const all = [];
  for (const rt of ['image', 'video', 'raw']) {
    let next;
    do {
      const page = await cloudinary.api.resources({
        resource_type: rt, type: 'authenticated', prefix: CAREERS_PREFIX,
        max_results: 500, ...(next ? { next_cursor: next } : {}),
      }).catch(() => ({ resources: [] }));
      (page.resources || []).forEach((r) => all.push({ ...r, _rt: rt }));
      next = page.next_cursor;
    } while (next);
  }
  console.log(`careers assets in Cloudinary: ${all.length}`);

  // ── The three conditions, all required ──────────────────────────────────────
  const doomed = [];
  const spared = { referenced: 0, folderInUse: 0, tooYoung: 0, noNonce: 0 };
  for (const r of all) {
    if (referenced.has(r.public_id)) { spared.referenced++; continue; }
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
    doomed.slice(0, 10).forEach((r) => console.log(`   would delete  ${r._rt.padEnd(6)} ${mb(r.bytes).padStart(6)} MB  ${r.public_id}`));
    if (doomed.length > 10) console.log(`   … and ${doomed.length - 10} more`);
    await mongoose.disconnect();
    return;
  }

  // ── Manifest BEFORE deletion; no manifest, no delete ────────────────────────
  const dir = path.resolve('retention-reports');
  fs.mkdirSync(dir, { recursive: true });
  const manifestPath = path.join(dir, `purged-abandoned-careers-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
  const lines = doomed.map((r) => JSON.stringify({
    publicId: r.public_id, resourceType: r._rt, bytes: r.bytes,
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

  // ── Delete, batched per resource_type (the API is per-type) ────────────────
  let deleted = 0; const failed = [];
  for (const rt of ['image', 'video', 'raw']) {
    const ids = doomed.filter((r) => r._rt === rt).map((r) => r.public_id);
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
    if (ids.length) console.log(`  ${rt}: ${ids.length} requested`);
  }

  bar('═');
  console.log(`DELETED: ${deleted} of ${doomed.length}   FAILED: ${failed.length}`);
  if (failed.length) failed.slice(0, 10).forEach((f) => console.log(`   ✗ ${f}`));
  console.log(`manifest: ${manifestPath}`);
  console.log('No restore path — Cloudinary backup is not enabled on this account.');
  bar('═');
  await mongoose.disconnect();
};

main().catch((e) => { console.error('[Purge] fatal:', e); process.exit(1); });
