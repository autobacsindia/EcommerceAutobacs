/**
 * Careers retention AUDIT — read-only. Shows exactly what a retention sweep
 * WOULD delete, so a human can verify before anything is destroyed.
 *
 * This script cannot delete. It has no delete call in it at all; that is
 * deliberate, so it can be run against production freely and so "let me check
 * what this would remove" never shares a code path with "remove it".
 *
 * ── The two categories, which are NOT the same problem ──────────────────────
 *
 * A. REJECTED — applications whose status is `rejected` and whose media is
 *    older than the retention window. These HAVE a database record, a name, an
 *    email and a rejection date, so they are fully identifiable and the window
 *    is measurable.
 *
 * B. ABANDONED — Cloudinary assets under `autobacs/careers/<nonce>/` whose
 *    submission folder maps to NO JobApplication. These have no status and no
 *    rejection date, because they never became applications: the careers form
 *    uploads files only at submit time, so a folder with files but no record is
 *    a submission that died between the upload finishing and the record being
 *    written. A rejection-based rule can never reach them — which is exactly
 *    why they need their own window and their own review.
 *
 * The folder nonce is the join key and it is reliable: it is server-minted per
 * submission (careersCloudinary.generateCareersUploadSignature), never client
 * supplied, and every referenced asset in one application shares one nonce.
 *
 * ── Output ──────────────────────────────────────────────────────────────────
 * A summary to stdout, plus a CSV at ./retention-reports/ listing every file.
 * With --sign, each row carries a short-lived signed URL so the files can
 * actually be opened and eyeballed.
 *
 *   ⚠ The CSV contains applicant PII (names, emails) and, with --sign, working
 *     links to CVs and video answers. It is written to a gitignored directory.
 *     Delete it when you are done reviewing.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *   cd Back-end/server
 *   node --import=dotenv/config scripts/audit-careers-retention.js
 *   node --import=dotenv/config scripts/audit-careers-retention.js --sign
 *
 *   --rejected-days=N   retention window after rejection (default 14)
 *   --abandoned-days=N  age after which an orphan folder counts as dead (default 7)
 *   --sign              mint 1-hour signed URLs for spot-checking
 *   --all               list every row, not just the first 20 per section
 */
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import cloudinary from '../config/cloudinary.js';
import { signedCareersAssetUrl } from '../utils/careersCloudinary.js';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt  = (n, d) => { const h = argv.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };

const REJECTED_DAYS  = Number(opt('rejected-days', 14));
const ABANDONED_DAYS = Number(opt('abandoned-days', 7));
const SIGN = flag('sign');
const SHOW = flag('all') ? Infinity : 20;

const SLOTS = ['videoOne', 'videoTwo', 'resume', 'support'];
const days = (d) => (Date.now() - new Date(d)) / 86400000;
const mb = (b) => (b / 1048576).toFixed(1);
const nonceOf = (p) => { const m = /^autobacs\/careers\/([^/]+)\//.exec(p || ''); return m ? m[1] : null; };
const bar = (c = '─') => console.log(c.repeat(78));

const main = async () => {
  /*
    autoIndex:false is mandatory for any script that reaches for a model — it
    defaults to true, and merely connecting would build every declared index
    against whatever cluster this points at, which for the local .env is PROD.
  */
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false });
  const JobApplication = (await import('../models/JobApplication.js')).default;
  const apps = await JobApplication.find({}).lean();

  // ── Category A: rejected past the window ──────────────────────────────────
  const rejected = apps
    .filter((a) => a.status === 'rejected')
    .map((a) => ({ app: a, age: days(a.updatedAt || a.createdAt) }))
    .filter((x) => x.age > REJECTED_DAYS)
    .sort((a, b) => b.age - a.age);

  // ── Category B: assets in folders with no application ─────────────────────
  const referenced = new Set();
  const appNonces = new Map();
  for (const a of apps) for (const s of SLOTS) {
    const p = a.files?.[s]?.publicId;
    if (!p) continue;
    referenced.add(p);
    const n = nonceOf(p); if (n) appNonces.set(n, a);
  }

  const all = [];
  for (const rt of ['image', 'video', 'raw']) {
    let next;
    do {
      const page = await cloudinary.api.resources({
        resource_type: rt, type: 'authenticated', prefix: 'autobacs/careers',
        max_results: 500, ...(next ? { next_cursor: next } : {}),
      }).catch(() => ({ resources: [] }));
      (page.resources || []).forEach((r) => all.push(r));
      next = page.next_cursor;
    } while (next);
  }

  const abandoned = all
    .filter((r) => !referenced.has(r.public_id))
    .filter((r) => !appNonces.has(nonceOf(r.public_id)))
    .map((r) => ({ r, age: days(r.created_at) }))
    .filter((x) => x.age > ABANDONED_DAYS)
    .sort((a, b) => b.age - a.age);

  const heldBack = all
    .filter((r) => !referenced.has(r.public_id) && !appNonces.has(nonceOf(r.public_id)))
    .filter((r) => days(r.created_at) <= ABANDONED_DAYS);

  // ── Report ────────────────────────────────────────────────────────────────
  bar('═');
  console.log('CAREERS RETENTION AUDIT — read-only, deletes nothing');
  bar('═');
  console.log(`rejected window : ${REJECTED_DAYS} days after rejection`);
  console.log(`abandoned window: ${ABANDONED_DAYS} days with no application`);
  console.log(`applications    : ${apps.length}   careers assets in Cloudinary: ${all.length}`);
  bar();

  const rows = [];

  console.log(`\nA. REJECTED >${REJECTED_DAYS} DAYS — ${rejected.length} application(s)`);
  console.log('   (media would be deleted; the application record + notes are KEPT)\n');
  let aBytes = 0, aFiles = 0;
  for (const [i, { app, age }] of rejected.entries()) {
    const files = SLOTS.map((s) => ({ slot: s, ...(app.files?.[s] || {}) })).filter((f) => f.publicId);
    const bytes = files.reduce((s, f) => s + (f.bytes || 0), 0);
    aBytes += bytes; aFiles += files.length;
    if (i < SHOW) {
      console.log(`  ${String(i + 1).padStart(3)}. ${app.fullName}  <${app.email}>`);
      console.log(`       role ${app.roleTitle} | rejected ${Math.floor(age)}d ago | app _id ${app._id}`);
      for (const f of files) {
        console.log(`       └─ ${f.slot.padEnd(9)} ${f.publicId}  (${mb(f.bytes || 0)} MB, ${f.resourceType || '?'})`);
      }
    }
    for (const f of files) {
      rows.push({
        category: 'rejected', reason: `rejected ${Math.floor(age)}d ago`,
        applicant: app.fullName, email: app.email, role: app.roleTitle,
        appId: String(app._id), slot: f.slot, publicId: f.publicId,
        resourceType: f.resourceType || '', bytes: f.bytes || 0,
        cloudinaryFolder: `autobacs/careers/${nonceOf(f.publicId) || ''}`,
        signedUrl: SIGN ? signedCareersAssetUrl(f.publicId, f.resourceType) : '',
      });
    }
  }
  if (rejected.length > SHOW) console.log(`  … and ${rejected.length - SHOW} more (see CSV, or pass --all)`);
  console.log(`\n   → ${aFiles} files, ${mb(aBytes)} MB`);

  const folders = [...new Set(abandoned.map((x) => nonceOf(x.r.public_id)))];
  console.log(`\nB. ABANDONED >${ABANDONED_DAYS} DAYS — ${abandoned.length} asset(s) in ${folders.length} folder(s)`);
  console.log('   (no application exists for these folders — nothing to be rejected)\n');
  const byFolder = new Map();
  abandoned.forEach((x) => {
    const n = nonceOf(x.r.public_id);
    if (!byFolder.has(n)) byFolder.set(n, []);
    byFolder.get(n).push(x);
  });
  let bBytes = 0;
  for (const [i, [nonce, items]] of [...byFolder.entries()].entries()) {
    const bytes = items.reduce((s, x) => s + (x.r.bytes || 0), 0);
    bBytes += bytes;
    if (i < SHOW) {
      console.log(`  ${String(i + 1).padStart(3)}. autobacs/careers/${nonce}/   ${items.length} file(s), ${mb(bytes)} MB, ${Math.floor(items[0].age)}d old`);
      items.forEach((x) => console.log(`       └─ ${x.r.public_id}  (${mb(x.r.bytes)} MB, ${x.r.resource_type})`));
    }
    items.forEach((x) => rows.push({
      category: 'abandoned', reason: `no application, ${Math.floor(x.age)}d old`,
      applicant: '', email: '', role: '', appId: '', slot: '',
      publicId: x.r.public_id, resourceType: x.r.resource_type, bytes: x.r.bytes,
      cloudinaryFolder: `autobacs/careers/${nonce}`,
      signedUrl: SIGN ? signedCareersAssetUrl(x.r.public_id, x.r.resource_type) : '',
    }));
  }
  if (byFolder.size > SHOW) console.log(`  … and ${byFolder.size - SHOW} more folders (see CSV, or pass --all)`);
  console.log(`\n   → ${abandoned.length} files, ${mb(bBytes)} MB`);

  if (heldBack.length) {
    console.log(`\n   ${heldBack.length} asset(s) are unattributable but NEWER than ${ABANDONED_DAYS} days —`);
    console.log('   deliberately held back in case a submission is still in flight.');
  }

  const dir = path.resolve('retention-reports');
  fs.mkdirSync(dir, { recursive: true });
  const csvPath = path.join(dir, `careers-retention-${new Date().toISOString().slice(0, 10)}.csv`);
  const cols = ['category', 'reason', 'applicant', 'email', 'role', 'appId', 'slot', 'publicId', 'resourceType', 'bytes', 'cloudinaryFolder', 'signedUrl'];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  fs.writeFileSync(csvPath, [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n'));

  bar('═');
  console.log(`TOTAL that a sweep would delete: ${rows.length} files, ${mb(aBytes + bBytes)} MB`);
  bar('═');
  console.log(`\nfull list: ${csvPath}`);
  console.log('  ⚠ contains applicant PII' + (SIGN ? ' and working 1-hour links to CVs/videos' : '') + ' — delete after review.');
  if (!SIGN) console.log('  re-run with --sign to get openable links for spot-checking.');
  console.log('\nVerify in Cloudinary: Media Library → autobacs → careers → <folder>');
  console.log('This script deletes nothing.');

  await mongoose.disconnect();
};

main().catch((e) => { console.error('[Audit] fatal:', e); process.exit(1); });
