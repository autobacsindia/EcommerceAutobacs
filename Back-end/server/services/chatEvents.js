import { EventEmitter } from 'events';
import { getRedisClient, isRedisHealthy } from './redisClient.js';

/**
 * Fan-out for team-chat events (new message, deleted message, new channel).
 *
 * Each open chat tab holds one SSE connection to ONE backend instance, but the
 * message may have been posted on another. So events go out over Redis pub/sub
 * and every instance re-emits what it receives to its own local listeners.
 *
 * Without Redis (local dev, tests, or Redis down) events are emitted in-process
 * only — fine for a single instance, and the client also catches up over REST on
 * reconnect (`?after=<seq>`), so a dropped event is a delay, never a lost message.
 */
const CHANNEL = 'chat:events';
const local = new EventEmitter();
local.setMaxListeners(0); // one listener per open SSE connection

let subscriber = null;
let subscribing = null;

function ensureSubscriber() {
  const redis = getRedisClient();
  if (!redis || subscriber || subscribing) return;
  subscribing = (async () => {
    try {
      const sub = redis.duplicate();
      sub.on('error', (err) => console.error('[chat] subscriber error:', err.message));
      sub.on('message', (channel, raw) => {
        if (channel !== CHANNEL) return;
        try { local.emit('event', JSON.parse(raw)); } catch { /* malformed — ignore */ }
      });
      await sub.subscribe(CHANNEL);
      subscriber = sub;
    } catch (err) {
      console.error('[chat] could not subscribe, using in-process events:', err.message);
    } finally {
      subscribing = null;
    }
  })();
}

/** Publish an event to every instance. Never throws — chat must not break a write. */
export async function publishChatEvent(event) {
  const redis = getRedisClient();
  if (redis && isRedisHealthy()) {
    try {
      await redis.publish(CHANNEL, JSON.stringify(event));
      // Our own listeners hear it back through the subscriber. If this instance
      // has listeners but its subscriber is still connecting, deliver locally so
      // those tabs are not skipped.
      if (!subscriber && local.listenerCount('event') > 0) local.emit('event', event);
      return;
    } catch (err) {
      console.error('[chat] publish failed, delivering locally:', err.message);
    }
  }
  local.emit('event', event);
}

/** Listen for chat events on this instance. Returns an unsubscribe function. */
export function onChatEvent(listener) {
  ensureSubscriber();
  local.on('event', listener);
  return () => local.off('event', listener);
}
