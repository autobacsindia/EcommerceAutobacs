/**
 * Read-only inspection of the shared response cache (Redis).
 *
 * Answers the question `X-Cache: MISS` on a repeated identical request raises:
 * is the entry never written, written and immediately invalidated, or written
 * under a key the next request does not compute?
 *
 * Read-only by construction — SCAN / TTL / MEMORY USAGE / EXISTS only. Safe to
 * point at production, which is the only place the answer means anything.
 *
 *   railway run node scripts/inspect-cache.js
 *   railway run node scripts/inspect-cache.js --path=/api/v1/categories
 *
 * ⚠️ Locally, REDIS_URL is the QUEUE redis, not the cache — running this without
 * `railway run` inspects the wrong instance and reports an empty cache.
 */

import 'dotenv/config';
import Redis from 'ioredis';
import crypto from 'crypto';
import { CACHE_VERSION } from '../services/cache/config.js';
import { routeNamespace } from '../utils/cacheKeys.js';
import { canonicalizeQuery } from '../utils/facetCacheKey.js';

const PROBE_PATHS = [
  '/api/v1/categories',
  '/api/v1/products/featured',
  '/api/v1/products/offers',
  '/api/v1/vehicles/makes',
  '/api/v1/products/brands',
];

const PREFIXES = [
  `${CACHE_VERSION}:resp:*`,
  'ctag:*',
  'route:*',
  'public:*',
  `${CACHE_VERSION}:products:facets:*`,
];

/** Mirrors middleware/httpCache.js buildResponseKey for an unauthenticated GET. */
function expectedKey(pathWithQuery) {
  const [path, qs = ''] = pathWithQuery.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs));
  const base = {
    path,
    query: canonicalizeQuery(query),
    locale: 'default',       // no Accept-Language header
    region: undefined,       // non-regional profiles
  };
  const hash = crypto.createHash('md5').update(JSON.stringify(base)).digest('hex');
  return `${CACHE_VERSION}:resp:${routeNamespace(pathWithQuery)}:${hash}`;
}

async function scanCount(redis, pattern, { sampleSize = 5 } = {}) {
  let cursor = '0';
  let count = 0;
  const samples = [];
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
    cursor = next;
    count += keys.length;
    for (const k of keys) {
      if (samples.length < sampleSize) samples.push(k);
    }
  } while (cursor !== '0');
  return { count, samples };
}

async function main() {
  const url = process.env.REDIS_URL;
  if (!url) {
    console.error('REDIS_URL is not set. Run under `railway run` to inspect production.');
    process.exit(1);
  }
  console.log(`[inspect-cache] CACHE_VERSION=${CACHE_VERSION}  host=${new URL(url).hostname}`);

  const redis = new Redis(url, {
    maxRetriesPerRequest: 3,
    connectTimeout: 10000,
    tls: url.startsWith('rediss://') ? {} : undefined,
  });

  try {
    console.log(`[inspect-cache] PING → ${await redis.ping()}`);
    console.log(`[inspect-cache] DBSIZE → ${await redis.dbsize()} keys total\n`);

    console.log('── key populations ──────────────────────────────────────────');
    for (const pattern of PREFIXES) {
      const { count, samples } = await scanCount(redis, pattern);
      console.log(`${pattern.padEnd(34)} ${String(count).padStart(6)}`);
      for (const key of samples) {
        console.log(`    ${key}  ttl=${await redis.ttl(key)}s`);
      }
    }

    // The decisive check: compute the key an unauthenticated GET would look up
    // and ask whether it is actually there.
    console.log('\n── expected keys for public GETs ────────────────────────────');
    const paths = process.argv
      .filter((a) => a.startsWith('--path='))
      .map((a) => a.slice('--path='.length));
    for (const path of (paths.length ? paths : PROBE_PATHS)) {
      const key = expectedKey(path);
      const exists = await redis.exists(key);
      const ttl = exists ? await redis.ttl(key) : null;
      console.log(
        `${path.padEnd(30)} ${exists ? 'PRESENT' : 'ABSENT '}  ttl=${ttl ?? '-'}  ${key}`,
      );
    }
  } finally {
    redis.disconnect();
  }
}

main().catch((err) => {
  console.error('[inspect-cache] failed:', err);
  process.exit(1);
});
