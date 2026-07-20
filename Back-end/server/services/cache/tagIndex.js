/**
 * Redis-backed tag index for deterministic cache invalidation.
 *
 * The old model hashed each request into an opaque `public:<md5>` key and
 * invalidated by *guessing* a glob (`PRODUCT_DETAIL:*<id>*`) that never matched
 * — a silent no-op (see Phase 0). Here every cached key is registered under one
 * or more tags in a Redis SET (`ctag:<tag>`), so invalidation is an exact
 * lookup of the affected keys, not a keyspace scan.
 *
 *   store:      SADD ctag:<tag> <key>   (+ EXPIRE, so the index self-cleans)
 *   invalidate: SMEMBERS ctag:<tag> → UNLINK members (batched) → DEL ctag:<tag>
 *
 * Why SETs over SCAN: on Upstash every command is billed and SCAN is
 * O(keyspace) on *every* product edit; a tag lookup is O(affected keys) and
 * deterministic. `scripts/flush-public-cache.js` keeps the SCAN sweep as the
 * manual panic button.
 *
 * Redis-down / no-Redis: all operations no-op safely. CacheService keeps its
 * in-memory tagMap for the REDIS_URL-unset path (dev/tests).
 */

import { redisClient } from './redisClient.js';

const TAG_PREFIX = 'ctag:';

/** Grace period a tag index outlives its longest-lived member (seconds). */
const TAG_INDEX_BUFFER = 600;

/**
 * Max lifetime (seconds) a tag-index SET can be given. The longest profile TTL
 * is 7200s (VEHICLE_MAKES); cacheProfiles enforces this ceiling so a member key
 * never outlives its index (which would strand it until its own TTL).
 */
export const MAX_TAGGED_TTL = 7200;
export const TAG_INDEX_TTL = MAX_TAGGED_TTL + TAG_INDEX_BUFFER;

const UNLINK_BATCH = 200;

const tagKeyFor = (tag) => `${TAG_PREFIX}${tag}`;

/**
 * Register a cache key under each tag. Fire-and-forget friendly: resolves even
 * if Redis is unavailable (logged, never thrown).
 *
 * The index SET is given an expiry of the KEY's own ttl + buffer, seeded with
 * `EXPIRE NX` (first member) and extended only via `EXPIRE GT` (a longer-lived
 * member added later). Net effect: the set lives just past its longest-lived
 * member, then self-expires — so a hot tag written continuously with short-TTL
 * keys can't accumulate dead members indefinitely (the previous fixed 7800s
 * refresh-on-every-write meant the set never expired under load). It still never
 * expires before a live member, so invalidation stays complete.
 *
 * Requires Redis ≥ 7.0 for the NX/GT flags (Upstash is 7+). If the flags error
 * on an older server the whole op is caught below and the key simply isn't
 * tag-indexed — invalidation then falls back to TTL, never incorrect.
 *
 * @param {string} key    the cache key that was just stored
 * @param {string[]} tags tags to file it under
 * @param {number} [ttl]  the stored key's TTL in seconds
 */
export async function addKeyToTags(key, tags, ttl = MAX_TAGGED_TTL) {
  if (!redisClient || !key || !tags?.length) return;
  const indexTtl = Math.min(ttl, MAX_TAGGED_TTL) + TAG_INDEX_BUFFER;
  try {
    const pipeline = redisClient.pipeline();
    for (const tag of tags) {
      const tagKey = tagKeyFor(tag);
      pipeline.sadd(tagKey, key);
      pipeline.expire(tagKey, indexTtl, 'NX'); // seed expiry on a brand-new set
      pipeline.expire(tagKey, indexTtl, 'GT'); // extend only for a longer-lived member
    }
    await pipeline.exec();
  } catch (err) {
    console.warn('[tagIndex] addKeyToTags failed:', err.message);
  }
}

/**
 * Invalidate every cache key filed under any of the given tags.
 * @param {...string} tags
 * @returns {Promise<number>} count of cache keys unlinked
 */
export async function invalidateTags(...tags) {
  if (!redisClient || !tags.length) return 0;
  let total = 0;
  for (const tag of tags) {
    const tagKey = tagKeyFor(tag);
    try {
      const members = await redisClient.smembers(tagKey);
      for (let i = 0; i < members.length; i += UNLINK_BATCH) {
        const batch = members.slice(i, i + UNLINK_BATCH);
        if (batch.length) total += await redisClient.unlink(...batch);
      }
      await redisClient.unlink(tagKey);
    } catch (err) {
      console.warn(`[tagIndex] invalidateTags('${tag}') failed:`, err.message);
    }
  }
  return total;
}
