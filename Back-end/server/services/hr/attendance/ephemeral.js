/**
 * Short-lived state for the punch path: liveness challenges (single use, a few
 * minutes), failed face attempts waiting for a "please review" tap, and attempt
 * counters. Deliberately NOT MongoDB — these are seconds-to-minutes values, and
 * writing them per request is exactly the telemetry-in-Mongo mistake the repo
 * forbids. Redis (REDIS_URL, the cache client) with TTLs.
 *
 * Without Redis (tests, a local dev box) an in-process Map stands in. That is
 * correct for one process only; production always has REDIS_URL (redisClient
 * logs CRITICAL when it is missing).
 */
import { getRedisClient } from '../../redisClient.js';

const PREFIX = 'hr:att:';
const memory = new Map(); // key → { value, expiresAt }

const memGet = (key) => {
  const hit = memory.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) { memory.delete(key); return null; }
  return hit.value;
};

function redis() {
  const r = getRedisClient();
  return r && r.status !== 'end' ? r : null;
}

/** Store `value` (JSON) under `key` for `ttlSeconds`. */
export async function put(key, value, ttlSeconds) {
  const k = PREFIX + key;
  const r = redis();
  if (r) { await r.set(k, JSON.stringify(value), 'EX', Math.max(1, Math.ceil(ttlSeconds))); return; }
  memory.set(k, { value: JSON.stringify(value), expiresAt: Date.now() + ttlSeconds * 1000 });
}

/** Read without consuming. */
export async function peek(key) {
  const k = PREFIX + key;
  const r = redis();
  const raw = r ? await r.get(k) : memGet(k);
  return raw ? JSON.parse(raw) : null;
}

/**
 * Read AND delete in one step: of two concurrent callers exactly one gets the
 * value. This is what makes a liveness challenge single-use.
 */
export async function take(key) {
  const k = PREFIX + key;
  const r = redis();
  if (r) {
    const raw = typeof r.getdel === 'function' ? await r.getdel(k) : await r.eval(
      "local v = redis.call('GET', KEYS[1]); if v then redis.call('DEL', KEYS[1]) end; return v", 1, k,
    );
    return raw ? JSON.parse(raw) : null;
  }
  const raw = memGet(k);
  memory.delete(k);
  return raw ? JSON.parse(raw) : null;
}

/** Increment a counter (created with `ttlSeconds` on first use); returns the new value. */
export async function incr(key, ttlSeconds) {
  const k = PREFIX + key;
  const r = redis();
  if (r) {
    const n = await r.incr(k);
    if (n === 1) await r.expire(k, Math.max(1, Math.ceil(ttlSeconds)));
    return n;
  }
  const cur = Number(memGet(k) || 0) + 1;
  const prev = memory.get(k);
  memory.set(k, { value: String(cur), expiresAt: prev && prev.expiresAt > Date.now() ? prev.expiresAt : Date.now() + ttlSeconds * 1000 });
  return cur;
}

export async function del(key) {
  const k = PREFIX + key;
  const r = redis();
  if (r) await r.del(k); else memory.delete(k);
}

/** Tests only. */
export const _resetMemory = () => memory.clear();
