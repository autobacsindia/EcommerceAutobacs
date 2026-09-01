/**
 * Copy every Cloudinary asset into Cloudflare R2.
 *
 * Phase 3 of the Cloudinary → R2 migration. This script moves BYTES ONLY. It
 * does not touch MongoDB, does not rewrite a single URL, and does not delete
 * anything from Cloudinary — so while it is running, and after it finishes, the
 * live site is byte-for-byte unchanged. That is deliberate: the copy is the one
 * step big enough to want to run against production early, so it is built to be
 * the step that cannot break production.
 *
 * ── Why this does not connect to MongoDB ────────────────────────────────────
 * It enumerates from the Cloudinary Admin API, not from our documents. So there
 * is no `mongoose.connect()` here and therefore no risk of the repo's classic
 * footgun — a script that imports models and builds every declared index
 * against prod because `autoIndex` defaults to true. Nothing to guard because
 * nothing connects.
 *
 * ── Public vs private ───────────────────────────────────────────────────────
 * Destination bucket comes from services/storage/assetScope.js, which is
 * FAIL-CLOSED: an unrecognised folder is skipped and reported, never defaulted
 * to public. Applicant CVs and answer videos, return evidence, support
 * attachments, invoices and shipping slips go to the private bucket, which has
 * no public domain at all. Read the header of that module before adding a
 * prefix — the failure is not recoverable by deleting the object afterwards.
 *
 * ── Safety ──────────────────────────────────────────────────────────────────
 *   • DRY-RUN by default. `--apply` is required to write a single byte.
 *   • Idempotent + resumable: an object already in R2 with a matching byte
 *     length is skipped, so an interrupted run resumes by simply re-running.
 *   • Two integrity checks per object (download length vs Cloudinary's count,
 *     then MD5 vs R2's ETag). A partial object is never recorded as copied.
 *   • Every run writes a JSONL manifest to ./migration-manifests/ for audit.
 *   • One failed asset is recorded and skipped; it never aborts the run.
 *
 * ── Rollback ────────────────────────────────────────────────────────────────
 * Nothing outside R2 was modified, so rollback is deleting what this wrote:
 *
 *   node scripts/migrate-cloudinary-to-r2.js --rollback --manifest=<file> --apply
 *
 * Or, since both buckets are new and empty before the first run, emptying them
 * in the Cloudflare dashboard is equally complete.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *   cd Back-end/server
 *
 *   # 1. dry run — prints the plan, writes nothing
 *   node --import=dotenv/config scripts/migrate-cloudinary-to-r2.js
 *
 *   # 2. one folder first, for real
 *   node --import=dotenv/config scripts/migrate-cloudinary-to-r2.js \
 *        --prefix=autobacs/products --apply
 *
 *   # 3. everything
 *   node --import=dotenv/config scripts/migrate-cloudinary-to-r2.js --apply
 *
 *   options
 *     --apply                 actually write (default: dry run)
 *     --prefix=<folder>       only assets whose public_id starts with this
 *     --resource-type=<t>     image | video | raw   (default: all three)
 *     --limit=<n>             stop after n resources (smoke tests)
 *     --concurrency=<n>       parallel copies (default 4)
 *     --manifest=<path>       manifest location (default: auto-named)
 *     --rollback              delete the objects listed in --manifest
 */
import fs from 'fs';
import path from 'path';
import cloudinary from '../config/cloudinary.js';
import { scopeFor, skipReason } from '../services/storage/assetScope.js';
import { r2KeyFor } from '../services/storage/keys.js';
import { migrateAll, summarise } from '../services/storage/cloudinaryMigrator.js';
import * as r2 from '../services/storage/r2Provider.js';
import { isR2Configured, missingR2Vars } from '../config/storage.js';

// ── CLI ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt  = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const APPLY       = flag('apply');
const ROLLBACK    = flag('rollback');
const PREFIX      = opt('prefix', '');
const LIMIT       = Number(opt('limit', Infinity));
const CONCURRENCY = Number(opt('concurrency', 4));
const RESOURCE_TYPES = opt('resource-type') ? [opt('resource-type')] : ['image', 'video', 'raw'];

const MANIFEST_DIR = path.resolve('migration-manifests');
const MANIFEST = opt(
  'manifest',
  path.join(MANIFEST_DIR, `r2-copy-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`),
);

const log = (...a) => console.log(...a);
const bar = (c = '─') => log(c.repeat(74));

// ── Cloudinary enumeration ───────────────────────────────────────────────────
/**
 * List every resource of a given resource_type and delivery type.
 * Cloudinary paginates at 500; `type` must be iterated explicitly because
 * `upload` (public) and `authenticated` (private) are separate namespaces and a
 * listing of one silently omits the other — which would leave every applicant
 * CV and every return video behind while reporting success.
 */
const listAll = async (resourceType, deliveryType) => {
  const out = [];
  let next;
  do {
    const page = await cloudinary.api.resources({
      resource_type: resourceType,
      type: deliveryType,
      max_results: 500,
      ...(PREFIX ? { prefix: PREFIX } : {}),
      ...(next ? { next_cursor: next } : {}),
    });
    out.push(...(page.resources || []));
    next = page.next_cursor;
  } while (next && out.length < LIMIT);
  return out.slice(0, LIMIT);
};

/**
 * Download one asset's ORIGINAL bytes.
 *
 * Deliberately fetches the untransformed master, not a derivative: R2 is
 * becoming the source of truth, and seeding it with a `q_auto` rendition would
 * bake today's compression choices into the archive permanently, with no way
 * back to the original.
 *
 * `authenticated` assets are not publicly fetchable, so they need a signed URL —
 * the same mechanism the app uses to show an admin a CV.
 */
const download = async (resource) => {
  const isAuthenticated = resource.type === 'authenticated';
  let url = resource.secure_url;

  if (isAuthenticated) {
    url = resource.resource_type === 'raw'
      ? cloudinary.utils.private_download_url(resource.public_id, resource.format, {
          resource_type: 'raw', type: 'authenticated',
          expires_at: Math.round(Date.now() / 1000) + 600,
        })
      : cloudinary.url(resource.public_id, {
          resource_type: resource.resource_type, type: 'authenticated',
          sign_url: true, secure: true, format: resource.format,
        });
  }

  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${r.status} ${r.statusText} for ${resource.public_id}`);
  return Buffer.from(await r.arrayBuffer());
};

// ── Rollback ─────────────────────────────────────────────────────────────────
const rollback = async () => {
  if (!fs.existsSync(MANIFEST)) {
    console.error(`[Rollback] manifest not found: ${MANIFEST}`);
    process.exit(1);
  }
  const rows = fs.readFileSync(MANIFEST, 'utf8').trim().split('\n')
    .map((l) => JSON.parse(l))
    .filter((r) => r.status === 'copied');

  log(`[Rollback] ${rows.length} objects were written by this manifest.`);
  if (!APPLY) {
    log('[Rollback] DRY RUN — re-run with --apply to delete them.');
    rows.slice(0, 20).forEach((r) => log(`  would delete ${r.scope}:${r.key}`));
    return;
  }
  for (const scope of ['public', 'private']) {
    const keys = rows.filter((r) => r.scope === scope).map((r) => r.key);
    if (!keys.length) continue;
    const { deleted, failed } = await r2.deleteObjects({ keys, scope });
    log(`[Rollback] ${scope}: deleted ${deleted}, failed ${failed.length}`);
  }
};

// ── Main ─────────────────────────────────────────────────────────────────────
const main = async () => {
  bar('═');
  log('Cloudinary → R2 byte copy');
  bar('═');
  log(`mode         : ${APPLY ? '*** APPLY (writing) ***' : 'DRY RUN (no writes)'}`);
  log(`resourceTypes: ${RESOURCE_TYPES.join(', ')}`);
  log(`prefix       : ${PREFIX || '(all)'}`);
  log(`concurrency  : ${CONCURRENCY}`);
  log(`manifest     : ${MANIFEST}`);
  bar();

  if (ROLLBACK) return rollback();

  log('Enumerating Cloudinary resources…');
  const resources = [];
  for (const rt of RESOURCE_TYPES) {
    for (const dt of ['upload', 'authenticated']) {
      try {
        const found = await listAll(rt, dt);
        if (found.length) log(`  ${rt}/${dt}: ${found.length}`);
        resources.push(...found);
      } catch (err) {
        // A resource_type with no assets 404s on some accounts — not fatal.
        log(`  ${rt}/${dt}: none (${err.message})`);
      }
    }
  }
  log(`total: ${resources.length} resources`);
  bar();

  fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
  const manifest = fs.createWriteStream(MANIFEST, { flags: 'a' });

  /*
    A dry run against an account where R2 is not configured yet still has real
    value: it audits the fail-closed bucket mapping in services/storage/assetScope.js
    against the actual production asset list, which is the check you want to pass
    BEFORE creating any buckets. In that case the "is it already there?" probe is
    skipped and every mapped asset reports as `would-copy / absent`.

    Never relaxed for --apply: writing without the resume check would re-upload
    the whole catalog on every run.
  */
  const canProbeR2 = isR2Configured();
  if (!canProbeR2 && APPLY) {
    console.error(`[Migrate] --apply needs R2 configured. Missing: ${missingR2Vars().join(', ')}`);
    process.exit(1);
  }
  if (!canProbeR2) {
    log('NOTE: R2 is not configured, so existing objects were not probed.');
    log(`      Missing: ${missingR2Vars().join(', ')}`);
    log('      This run audits the bucket MAPPING only.');
    bar();
  }

  let done = 0;
  const rows = await migrateAll(
    resources,
    {
      scopeFor, skipReason, r2KeyFor, download, apply: APPLY,
      headObject: canProbeR2 ? r2.headObject : async () => null,
      putObject: r2.putObject,
    },
    {
      concurrency: CONCURRENCY,
      onResult: (row) => {
        manifest.write(`${JSON.stringify(row)}\n`);
        done += 1;
        if (done % 100 === 0 || row.status === 'failed') {
          log(`  [${done}/${resources.length}] ${row.status.padEnd(11)} ${row.publicId || ''} ${row.reason || ''}`);
        }
      },
    },
  );
  /*
    Wait for the manifest to actually reach disk. `end()` only REQUESTS the
    close; the process.exit() below would otherwise tear the process down with
    buffered rows still unwritten — losing the audit trail and, with it, the
    rollback path, which is derived entirely from this file. Observed as a
    zero-byte manifest after a clean-looking run.
  */
  await new Promise((resolve, reject) => {
    manifest.on('finish', resolve);
    manifest.on('error', reject);
    manifest.end();
  });

  const s = summarise(rows);
  bar('═');
  log(`copied     : ${s.copied}  (${(s.bytes / 1048576).toFixed(1)} MB)`);
  log(`would copy : ${s.wouldCopy}`);
  log(`skipped    : ${s.skipped}  (${s.deliberatelySkipped} deliberately excluded/orphaned)`);
  log(`failed     : ${s.failed}`);
  bar('═');

  if (s.unmapped.length) {
    log('');
    log(`⚠  ${s.unmapped.length} asset(s) had NO bucket mapping and were NOT copied.`);
    log('   This is the fail-closed default — decide public vs private for each,');
    log('   add the prefix to services/storage/assetScope.js, then re-run.');
    s.unmapped.slice(0, 40).forEach((id) => log(`     ${id}`));
    if (s.unmapped.length > 40) log(`     … and ${s.unmapped.length - 40} more (see manifest)`);
  }

  if (s.failed) {
    log('');
    log(`⚠  ${s.failed} asset(s) failed. They are recorded in the manifest; re-running`);
    log('   retries only those (successful objects are skipped as already-present).');
  }

  log('');
  log(`manifest: ${MANIFEST}`);
  if (!APPLY) log('DRY RUN — nothing was written. Re-run with --apply.');
  else log(`rollback: node scripts/migrate-cloudinary-to-r2.js --rollback --manifest=${MANIFEST} --apply`);
};

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error('[Migrate] fatal:', err); process.exit(1); });
