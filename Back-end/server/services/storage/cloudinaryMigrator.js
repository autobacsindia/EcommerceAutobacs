/**
 * Cloudinary → R2 byte copy.
 *
 * Pure orchestration with every side effect injected, so the dangerous parts
 * (what gets downloaded, what gets written, what gets skipped) are testable
 * without touching a real account. `scripts/migrate-cloudinary-to-r2.js` is the
 * CLI wrapper that supplies the real dependencies.
 *
 * ── Safety model ────────────────────────────────────────────────────────────
 * The copy is ADDITIVE and REVERSIBLE: it writes only to R2 and never mutates
 * Cloudinary or MongoDB. Rolling back is deleting the R2 objects. That is what
 * makes it safe to run against production before any code depends on it.
 *
 * ── Idempotency and resumability ────────────────────────────────────────────
 * Every asset is keyed deterministically (services/storage/keys.js), and an
 * object already present in R2 with a MATCHING BYTE LENGTH is skipped. So a run
 * interrupted at 4,000 of 6,840 resumes by re-listing and skipping what landed —
 * no cursor to persist, no state to corrupt, and a second full run is a no-op.
 *
 * Size is the resume check because it is one cheap HEAD. Integrity is checked
 * separately and more strictly (MD5, below) on objects we actually write.
 *
 * ── Integrity ───────────────────────────────────────────────────────────────
 * Two independent checks, because a truncated download is the failure mode that
 * silently destroys an image:
 *   1. downloaded length === the byte count Cloudinary reports for the asset;
 *   2. MD5 of the buffer we uploaded === the ETag R2 returns for the object.
 * R2's ETag is the MD5 hex for a single-part PUT, so (2) is a genuine
 * end-to-end checksum and not just a round-trip of our own number.
 * A failure at either point records the asset as failed and moves on; it never
 * writes a partial object and calls it done.
 */
import crypto from 'crypto';

/** Long-lived immutable caching for public catalog objects. */
export const PUBLIC_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** Content types Cloudinary's `format` maps to. Falls back to octet-stream. */
const CONTENT_TYPES = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  avif: 'image/avif', gif: 'image/gif', svg: 'image/svg+xml',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
  pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv',
};

export const contentTypeFor = (format) =>
  CONTENT_TYPES[String(format || '').toLowerCase()] || 'application/octet-stream';

export const md5 = (buffer) => crypto.createHash('md5').update(buffer).digest('hex');

/**
 * Decide what to do with one Cloudinary resource, without doing it.
 *
 * @returns {{ action:'copy'|'skip', reason?:string, key?:string, scope?:string }}
 */
export const planAsset = (resource, { scopeFor, r2KeyFor, skipReason }) => {
  const publicId = resource?.public_id;
  const scope = scopeFor(publicId);
  if (!scope) {
    // 'excluded'/'orphaned' are decisions already recorded in assetScope.js;
    // only 'unmapped' means a human still owes one. Keeping them distinct is
    // what stops the operator warning from being 78 lines of demo content.
    return { action: 'skip', reason: (skipReason ? skipReason(publicId) : 'unmapped'), publicId };
  }
  const key = r2KeyFor({ publicId, format: resource.format });
  if (!key) return { action: 'skip', reason: 'no-key', publicId };
  return { action: 'copy', key, scope, publicId };
};

/**
 * Copy a single resource. Returns a manifest row describing what happened.
 *
 * @param {object} resource  Cloudinary Admin API resource
 * @param {object} deps
 * @param {Function} deps.scopeFor
 * @param {Function} deps.r2KeyFor
 * @param {Function} deps.download        (resource) => Promise<Buffer>
 * @param {Function} deps.headObject      ({key,scope}) => Promise<{bytes,etag}|null>
 * @param {Function} deps.putObject       ({body,key,scope,contentType,cacheControl}) => Promise<any>
 * @param {boolean}  deps.apply           false = dry run, perform no writes
 */
export const copyAsset = async (resource, deps) => {
  const { download, headObject, putObject, apply } = deps;
  const plan = planAsset(resource, deps);
  const base = {
    publicId: plan.publicId,
    key: plan.key || '',
    scope: plan.scope || '',
    sourceBytes: Number(resource?.bytes ?? 0),
  };

  if (plan.action === 'skip') return { ...base, status: 'skipped', reason: plan.reason };

  // Resume check. A HEAD that cannot determine existence THROWS (see
  // r2Provider) rather than reporting absent, so a transient R2 outage can never
  // be mistaken for "not copied yet" and trigger a full needless re-copy.
  const existing = await headObject({ key: plan.key, scope: plan.scope });
  if (existing && existing.bytes === base.sourceBytes) {
    return { ...base, status: 'skipped', reason: 'already-present' };
  }

  if (!apply) {
    return {
      ...base,
      status: 'would-copy',
      reason: existing ? 'size-mismatch' : 'absent',
    };
  }

  const body = await download(resource);

  // Integrity check 1 — a truncated download must never be written.
  if (base.sourceBytes && body.length !== base.sourceBytes) {
    return {
      ...base,
      status: 'failed',
      reason: `size-mismatch: downloaded ${body.length}, expected ${base.sourceBytes}`,
    };
  }

  const checksum = md5(body);
  await putObject({
    body,
    key: plan.key,
    scope: plan.scope,
    contentType: contentTypeFor(resource.format),
    // Only public objects are edge-cached; a private object is read through a
    // short-lived signed URL and must not be cached by anything in between.
    cacheControl: plan.scope === 'public' ? PUBLIC_CACHE_CONTROL : 'private, no-store',
  });

  // Integrity check 2 — end-to-end MD5 against what R2 actually stored.
  const written = await headObject({ key: plan.key, scope: plan.scope });
  if (!written) {
    return { ...base, status: 'failed', reason: 'object missing immediately after write' };
  }
  if (written.bytes !== body.length) {
    return { ...base, status: 'failed', reason: `stored ${written.bytes} bytes, sent ${body.length}` };
  }
  if (written.etag && written.etag !== checksum) {
    return { ...base, status: 'failed', reason: `checksum mismatch: r2 ${written.etag} vs local ${checksum}` };
  }

  return { ...base, status: 'copied', bytes: body.length, md5: checksum };
};

/**
 * Run a bounded-concurrency copy over a list of resources.
 *
 * Concurrency is deliberately modest by default: the bottleneck is Cloudinary's
 * CDN egress and R2 ingest, and a high fan-out mostly buys throttling. Ordering
 * within the list is not preserved in the output.
 */
export const migrateAll = async (resources, deps, { concurrency = 4, onResult } = {}) => {
  const results = [];
  let cursor = 0;

  const worker = async () => {
    while (cursor < resources.length) {
      const resource = resources[cursor++];
      let row;
      try {
        row = await copyAsset(resource, deps);
      } catch (err) {
        row = {
          publicId: resource?.public_id,
          key: '',
          scope: '',
          status: 'failed',
          reason: err.message,
        };
      }
      results.push(row);
      if (onResult) onResult(row);
    }
  };

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, resources.length || 1)) }, worker)
  );
  return results;
};

/** Aggregate manifest rows into a printable summary. */
export const summarise = (rows) => {
  const out = { copied: 0, skipped: 0, wouldCopy: 0, failed: 0, bytes: 0, unmapped: [], deliberatelySkipped: 0 };
  rows.forEach((r) => {
    if (r.status === 'copied') { out.copied++; out.bytes += r.bytes || 0; }
    else if (r.status === 'would-copy') out.wouldCopy++;
    else if (r.status === 'failed') out.failed++;
    else {
      out.skipped++;
      if (r.reason === 'unmapped') out.unmapped.push(r.publicId);
      else if (r.reason === 'excluded' || r.reason === 'orphaned') out.deliberatelySkipped++;
    }
  });
  return out;
};

export default { planAsset, copyAsset, migrateAll, summarise, contentTypeFor, md5, PUBLIC_CACHE_CONTROL };
