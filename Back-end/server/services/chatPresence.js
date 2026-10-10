import { getRedisClient, isRedisHealthy } from './redisClient.js';

/**
 * Who currently has team chat open. Used for one decision only: whether an
 * @mention also needs an email. Someone looking at the chat does not need mail
 * about a message they just saw.
 *
 * A key per connected user with a short TTL, refreshed by the SSE heartbeat, so
 * a crashed tab or a dead instance expires on its own — nothing to clean up.
 * Without Redis it falls back to this instance's own connections, which is
 * correct for a single-instance deployment and fails safe (treated as offline,
 * so the email is sent) otherwise.
 */
const TTL_SECONDS = 90;
const key = (userId) => `chat:online:${userId}`;
const localUntil = new Map(); // userId -> expiry ms

export async function markOnline(userId) {
  const id = String(userId);
  localUntil.set(id, Date.now() + TTL_SECONDS * 1000);
  const redis = getRedisClient();
  if (!redis || !isRedisHealthy()) return;
  try {
    await redis.set(key(id), '1', 'EX', TTL_SECONDS);
  } catch { /* presence is best-effort; a missed beat only costs an extra email */ }
}

export async function markOffline(userId) {
  const id = String(userId);
  localUntil.delete(id);
  const redis = getRedisClient();
  if (!redis || !isRedisHealthy()) return;
  try {
    await redis.del(key(id));
  } catch { /* the TTL will clear it */ }
}

/** @returns {Promise<Set<string>>} the subset of `userIds` with chat open. */
export async function onlineAmong(userIds = []) {
  const ids = userIds.map(String);
  if (!ids.length) return new Set();

  const now = Date.now();
  const online = new Set(ids.filter((id) => (localUntil.get(id) ?? 0) > now));

  const redis = getRedisClient();
  if (redis && isRedisHealthy()) {
    try {
      const found = await redis.mget(ids.map(key));
      ids.forEach((id, i) => { if (found[i]) online.add(id); });
    } catch { /* fall back to what this instance knows */ }
  }
  return online;
}
