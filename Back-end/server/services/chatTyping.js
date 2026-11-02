import { getRedisClient, isRedisHealthy } from './redisClient.js';

/**
 * "Ravi is typing…" — the throttle behind it.
 *
 * Each keystroke burst asks to announce; at most one announcement per person
 * per conversation (and thread) goes out every TYPING_THROTTLE_SECONDS. The
 * claim is a Redis key with that TTL (SET NX EX), so the throttle holds across
 * instances and needs no clean-up. Nothing is ever written to MongoDB: typing
 * is a passing signal, not a record.
 *
 * Without Redis it falls back to this instance's own memory — right for one
 * instance, and at worst a few extra announcements otherwise.
 */
export const TYPING_THROTTLE_SECONDS = 3;
const key = (channelId, userId, threadRoot) => `chat:typing:${channelId}:${threadRoot || '-'}:${userId}`;
const localUntil = new Map(); // key -> expiry ms

/** @returns {Promise<boolean>} true when this caller may announce now. */
export async function claimTyping(channelId, userId, threadRoot = null) {
  const k = key(String(channelId), String(userId), threadRoot ? String(threadRoot) : null);
  const redis = getRedisClient();
  if (redis && isRedisHealthy()) {
    try {
      return (await redis.set(k, '1', 'EX', TYPING_THROTTLE_SECONDS, 'NX')) === 'OK';
    } catch { /* fall through to local memory */ }
  }
  const now = Date.now();
  if ((localUntil.get(k) ?? 0) > now) return false;
  localUntil.set(k, now + TYPING_THROTTLE_SECONDS * 1000);
  if (localUntil.size > 5000) {
    for (const [kk, until] of localUntil) if (until <= now) localUntil.delete(kk);
  }
  return true;
}
