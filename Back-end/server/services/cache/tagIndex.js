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

/**
 * TTL (seconds) for a tag-index SET. Must exceed the longest cache-entry TTL so
 * an index never expires while a key it points at is still live (which would
 * strand that key until its own TTL). The longest profile TTL is 7200s
 * (VEHICLE_MAKES); 2h10m gives head-room. cacheProfiles enforces the ceiling.
 *
 * Members whose underlying key has already expired are harmless — UNLINK of a
 * missing key is a no-op — so we never need to prune them individually.
 */
export const TAG_INDEX_TTL = 7800;

/** Largest cache-entry TTL the tag index can guarantee to outlive. */
export const MAX_TAGGED_TTL = TAG_INDEX_TTL - 600;

const UNLINK_BATCH = 200;

const tagKeyFor = (tag) => `${TAG_PREFIX}${tag}`;

/**
 * Register a cache key under each tag. Fire-and-forget friendly: resolves even
 * if Redis is unavailable (logged, never thrown).
 * @param {string} key       the cache key that was just stored
 * @param {string[]} tags    tags to file it under
 */
export async function addKeyToTags(key, tags) {
  if (!redisClient || !key || !tags?.length) return;
  try {
    const pipeline = redisClient.pipeline();
    for (const tag of tags) {
      const tagKey = tagKeyFor(tag);
      pipeline.sadd(tagKey, key);
      pipeline.expire(tagKey, TAG_INDEX_TTL);
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
