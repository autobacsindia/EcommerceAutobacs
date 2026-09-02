/**
 * Cloudflare R2 storage provider (S3-compatible).
 *
 * Implements the storage interface the app uses for every uploaded asset:
 * put / delete / head / presigned PUT / presigned GET. R2 speaks the S3 API, so
 * this is the AWS SDK pointed at an R2 endpoint with `region: 'auto'`.
 *
 * ── Why presigned URLs, not proxying bytes ──────────────────────────────────
 * The browser uploads and downloads DIRECTLY against R2 using a short-lived
 * signed URL; the bytes never pass through our API. That preserves the property
 * the Cloudinary flow already had — no request-body ceiling (Vercel caps a proxied
 * request around 4.5 MB, and a careers answer video is far bigger than that) —
 * and it keeps the credentials server-side, because a presigned URL grants
 * exactly one operation on exactly one key for a bounded window.
 *
 * ── Private assets are bearer-credential reads ──────────────────────────────
 * A presigned GET is a capability: anyone holding the URL can read the object
 * until it expires. That is the same trade Cloudinary's `private_download_url`
 * made, with the same mitigation — a short TTL (see config/storage.js) and
 * server-side minting only. It is why the private bucket has no custom domain:
 * an expiring capability is the ONLY way to read it.
 */
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import AppError from '../../utils/AppError.js';
import { r2Config, assertR2Configured } from '../../config/storage.js';
import { toObjectUrl } from './keys.js';

/** S3 DeleteObjects hard limit — larger batches are rejected outright. */
const DELETE_BATCH_SIZE = 1000;

let _client = null;

/**
 * Lazily built, memoised S3 client.
 *
 * Lazy because config is read from env at call time (scripts load dotenv after
 * the module graph is built); memoised because the SDK client holds a connection
 * pool and rebuilding it per call would leak sockets under load.
 */
const client = () => {
  if (_client) return _client;
  assertR2Configured();
  const cfg = r2Config();
  _client = new S3Client({
    region: 'auto',
    endpoint: cfg.endpoint,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
    // The SDK retries throttling/5xx with exponential backoff. Three attempts is
    // the SDK default and is right here: an upload is user-facing, so failing
    // fast and surfacing a retryable error beats a long silent stall.
    maxAttempts: 3,
  });
  return _client;
};

/** Test seam — drop the memoised client so a new config takes effect. */
export const resetClient = () => { _client = null; };

/**
 * Resolve a logical bucket name.
 * @param {'public'|'private'} scope
 */
const bucketFor = (scope) => {
  const cfg = r2Config();
  if (scope === 'private') return cfg.privateBucket;
  if (scope === 'public') return cfg.publicBucket;
  throw new AppError(`[Storage] Unknown bucket scope "${scope}"`, 500);
};

/**
 * Upload a buffer.
 *
 * @param {object} opts
 * @param {Buffer} opts.body
 * @param {string} opts.key                 full object key (see keys.js)
 * @param {'public'|'private'} opts.scope
 * @param {string} [opts.contentType]
 * @param {string} [opts.cacheControl]      public assets should set a long immutable TTL
 * @returns {Promise<{ key: string, bucket: string, url: string }>}
 *          `url` is '' for private objects — they have no permanent address.
 */
export const putObject = async ({ body, key, scope, contentType, cacheControl }) => {
  if (!key) throw new AppError('[Storage] putObject requires a key', 500);
  const bucket = bucketFor(scope);
  try {
    await client().send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType || 'application/octet-stream',
      ...(cacheControl ? { CacheControl: cacheControl } : {}),
    }));
  } catch (err) {
    console.error(`[Storage] put failed — ${bucket}/${key}: ${err.message}`);
    throw new AppError(`Storage upload failed: ${err.message}`, 500);
  }
  return {
    key,
    bucket,
    url: scope === 'public' ? toObjectUrl(r2Config().publicBaseUrl, key) : '',
  };
};

/**
 * Object metadata, or null when the object does not exist.
 *
 * `null` for "absent" and a THROW for "could not determine" is a deliberate
 * distinction the callers depend on: the migration verifier treats absent as
 * "copy it" but must treat a network error as "stop", and the upload validator
 * treats absent as "reject the submission" but must not silently accept an
 * asset it failed to check. Collapsing both into null would turn an outage into
 * either mass re-copying or a validation bypass.
 */
export const headObject = async ({ key, scope }) => {
  const bucket = bucketFor(scope);
  try {
    const r = await client().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return {
      key,
      bytes: Number(r.ContentLength ?? 0),
      contentType: r.ContentType || '',
      etag: (r.ETag || '').replace(/"/g, ''),
    };
  } catch (err) {
    const status = err?.$metadata?.httpStatusCode;
    if (status === 404 || err?.name === 'NotFound' || err?.name === 'NoSuchKey') return null;
    console.error(`[Storage] head failed — ${bucket}/${key}: ${err.message}`);
    throw new AppError(`Storage head failed: ${err.message}`, 500);
  }
};

/** True when the object exists. Propagates non-404 errors (see headObject). */
export const objectExists = async ({ key, scope }) => (await headObject({ key, scope })) !== null;

/** Download an object into a Buffer (used by the migration verifier). */
export const getObjectBuffer = async ({ key, scope }) => {
  const bucket = bucketFor(scope);
  try {
    const r = await client().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return Buffer.from(await r.Body.transformToByteArray());
  } catch (err) {
    console.error(`[Storage] get failed — ${bucket}/${key}: ${err.message}`);
    throw new AppError(`Storage read failed: ${err.message}`, 500);
  }
};

/**
 * Read the first `bytes` of an object.
 *
 * Exists so content sniffing costs a few hundred bytes instead of a full
 * download: a careers answer video is up to 30 MB and the signature that
 * identifies it lives in the first dozen. Uses an HTTP Range request, so R2
 * transfers only that slice.
 *
 * Returns an empty Buffer when the object is missing, so a caller sniffing an
 * absent key gets "no signature" rather than an exception — absence is already
 * caught by the separate existence check.
 */
export const getObjectHead = async ({ key, scope, bytes = 512 }) => {
  const bucket = bucketFor(scope);
  try {
    const r = await client().send(new GetObjectCommand({
      Bucket: bucket, Key: key, Range: `bytes=0-${Math.max(0, bytes - 1)}`,
    }));
    return Buffer.from(await r.Body.transformToByteArray());
  } catch (err) {
    const status = err?.$metadata?.httpStatusCode;
    if (status === 404 || err?.name === 'NoSuchKey' || err?.name === 'NotFound') return Buffer.alloc(0);
    console.error(`[Storage] range read failed — ${bucket}/${key}: ${err.message}`);
    throw new AppError(`Storage read failed: ${err.message}`, 500);
  }
};

/**
 * Delete one object. Resolves even when the key is already gone — S3 delete is
 * idempotent, and a cleanup path that throws on "already deleted" turns a
 * successful retry into a permanent failure.
 */
export const deleteObject = async ({ key, scope }) => {
  const bucket = bucketFor(scope);
  try {
    await client().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (err) {
    // Logged with the same [CLEANUP_REQUIRED] marker the Cloudinary helper uses,
    // so the existing log alert keeps working across the migration.
    console.error(`[CLEANUP_REQUIRED][Storage] delete failed — ${bucket}/${key}: ${err.message}`);
    return false;
  }
};

/**
 * Delete many objects, chunked to the S3 batch limit.
 * @returns {Promise<{ deleted: number, failed: string[] }>}
 */
export const deleteObjects = async ({ keys = [], scope }) => {
  const list = keys.filter((k) => typeof k === 'string' && k);
  if (!list.length) return { deleted: 0, failed: [] };
  const bucket = bucketFor(scope);
  let deleted = 0;
  const failed = [];

  for (let i = 0; i < list.length; i += DELETE_BATCH_SIZE) {
    const chunk = list.slice(i, i + DELETE_BATCH_SIZE);
    try {
      const r = await client().send(new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
      }));
      const errs = r.Errors || [];
      errs.forEach((e) => failed.push(e.Key));
      deleted += chunk.length - errs.length;
      errs.forEach((e) =>
        console.error(`[CLEANUP_REQUIRED][Storage] delete failed — ${bucket}/${e.Key}: ${e.Message}`));
    } catch (err) {
      chunk.forEach((k) => failed.push(k));
      console.error(`[CLEANUP_REQUIRED][Storage] delete batch failed — ${bucket}: ${err.message}`);
    }
  }
  return { deleted, failed };
};

/**
 * Presigned PUT for a direct browser upload.
 *
 * ⚠ `contentType` is signed but NOT ENFORCED. Verified against the live bucket:
 * a URL signed for `image/png` accepted a body sent as `text/html`, and R2 then
 * stored and served it as `text/html`. Treat the signed Content-Type as a hint
 * to the client — it shapes the object key and gives an early, friendly
 * rejection — and never as a control.
 *
 * The real gates are elsewhere, and both are required:
 *   - size and existence come from headObject() at submit time, from the store
 *     rather than from the client;
 *   - the FORMAT is re-derived by reading the first bytes back out and matching
 *     the magic number (services/storage/contentSniff.js). That is what replaces
 *     the decode Cloudinary used to do for free.
 * Public delivery adds a third: the image Worker clamps every served
 * Content-Type to an image allowlist and sends `X-Content-Type-Options: nosniff`.
 */
export const presignPut = async ({ key, scope, contentType, expiresIn }) => {
  if (!key) throw new AppError('[Storage] presignPut requires a key', 500);
  const bucket = bucketFor(scope);
  const cfg = r2Config();
  const url = await getSignedUrl(
    client(),
    new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
    { expiresIn: expiresIn || cfg.signedPutTtlSeconds },
  );
  return { url, key, bucket, expiresIn: expiresIn || cfg.signedPutTtlSeconds };
};

/**
 * Presigned GET for a private object — the R2 equivalent of Cloudinary's
 * `private_download_url`, with the same short TTL semantics.
 */
export const presignGet = async ({ key, scope = 'private', expiresIn, downloadAs }) => {
  if (!key) return '';
  const bucket = bucketFor(scope);
  const cfg = r2Config();
  return getSignedUrl(
    client(),
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      // Force a download with a friendly filename where the caller wants one
      // (resumes, invoices) rather than rendering inline.
      ...(downloadAs
        ? { ResponseContentDisposition: `attachment; filename="${downloadAs.replace(/"/g, '')}"` }
        : {}),
    }),
    { expiresIn: expiresIn || cfg.signedGetTtlSeconds },
  );
};

/**
 * List keys under a prefix (migration auditing, orphan sweeps). Paginates
 * internally.
 *
 * `lastModified` is carried through because the abandoned-asset sweep is
 * age-gated: it only deletes an unreferenced object once it is old enough that
 * no in-flight submission could still be about to claim it. Without an
 * age, that sweep would race a form the applicant is still filling in.
 */
export const listKeys = async ({ prefix = '', scope, limit = Infinity }) => {
  const bucket = bucketFor(scope);
  const out = [];
  let token;
  do {
    const r = await client().send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: token,
    }));
    (r.Contents || []).forEach((o) => {
      if (out.length < limit) out.push({ key: o.Key, bytes: o.Size, lastModified: o.LastModified });
    });
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token && out.length < limit);
  return out;
};

export default {
  putObject, headObject, objectExists, getObjectBuffer, getObjectHead,
  deleteObject, deleteObjects, presignPut, presignGet, listKeys, resetClient,
};
