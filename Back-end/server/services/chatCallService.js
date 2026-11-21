import crypto from 'crypto';
import mongoose from 'mongoose';
import AppError from '../utils/AppError.js';
import chatCallRepository from '../repositories/chatCallRepository.js';
import chatRepository from '../repositories/chatRepository.js';
import userRepository from '../repositories/userRepository.js';
import { canAccess, isChatUser, postCallLine } from './chatService.js';
import { publishChatEvent } from './chatEvents.js';
import { sendToUsers } from './pushService.js';
import { cloudflareTurnServers } from './callRelay.js';

/**
 * Person-to-person calls in team-chat DMs.
 *
 * The audio and video go straight between the two browsers (WebRTC); nothing
 * of the call itself passes through this server. What lives here is the call's
 * management and its *signalling*: the small "here is how to reach me"
 * messages the two browsers must swap before they can connect. Those ride the
 * team-chat live stream (chatEvents → SSE) that already reaches every open
 * panel tab, routed to the DM so only its two members ever receive them.
 *
 * Invariants:
 *   - Only the two members of a two-person DM can ring, answer, signal or end.
 *   - One live call per DM (unique partial index) — two people pressing Call
 *     at the same moment land in one call.
 *   - Every state change is a conditional update on the current state, so a
 *     race (both hang up; a hang-up and the ring timeout) ends the call once,
 *     and leaves one chat line (keyed on the call id).
 *   - A ring ends by RING_MS: an in-process timer for the normal case, and the
 *     minute sweep (cronService) for an instance that died mid-ring.
 */

const fail = (message, status, code) => {
  const err = new AppError(message, status, { expose: true });
  if (code) err.code = code; // lets the call screen tell "busy" from "ended" without parsing words
  return err;
};
const idOf = (v) => String(v?._id ?? v);
const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);

export const RING_MS = num(process.env.CALL_RING_SECONDS, 30) * 1000;
/** Browsers beat every HEARTBEAT_MS; a side silent for STALE_MS has gone. */
export const HEARTBEAT_MS = 10_000;
export const STALE_MS = num(process.env.CALL_STALE_SECONDS, 45) * 1000;
/** A signal is an SDP description or a batch of ICE candidates — a few KB. */
export const MAX_SIGNAL_BYTES = 64 * 1024;
export const SIGNAL_KINDS = Object.freeze(['offer', 'answer', 'candidates']);
const DEVICE_ID = /^[A-Za-z0-9_-]{8,64}$/;

// ── helpers ──────────────────────────────────────────────────────────────────

function checkDevice(deviceId) {
  if (typeof deviceId !== 'string' || !DEVICE_ID.test(deviceId)) throw fail('Invalid device', 400);
  return deviceId;
}

/** The DM, if `user` is one of its two people. 404 otherwise — never confirm a private chat exists. */
async function loadDm(user, channelId) {
  if (!mongoose.isValidObjectId(channelId)) throw fail('Conversation not found', 404);
  const channel = await chatRepository.findChannelById(channelId);
  if (!channel || !canAccess(user, channel)) throw fail('Conversation not found', 404);
  if (channel.kind !== 'dm' || (channel.members || []).length !== 2) {
    throw fail('Calls are only for one-to-one chats', 400);
  }
  return channel;
}

/** The call, if `user` is in it. 404 otherwise. */
async function loadOwnCall(user, callId) {
  if (!mongoose.isValidObjectId(callId)) throw fail('Call not found', 404);
  const call = await chatCallRepository.findById(callId);
  const uid = idOf(user);
  if (!call || (idOf(call.caller) !== uid && idOf(call.callee) !== uid)) throw fail('Call not found', 404);
  return call;
}

const sideOf = (call, user) => (idOf(call.caller) === idOf(user) ? 'caller' : 'callee');
const peerSide = (side) => (side === 'caller' ? 'callee' : 'caller');
const chatPath = (user) => (user?.role === 'admin' ? '/admin/chat' : '/team/chat');

/** What a browser is told about a call. Device ids are only ever sent to the call's own two people. */
export function shapeCall(call) {
  return {
    id: idOf(call),
    channelId: idOf(call.channel),
    callerId: idOf(call.caller),
    calleeId: idOf(call.callee),
    callerDevice: call.callerDevice ?? null,
    calleeDevice: call.calleeDevice ?? null,
    media: call.media,
    status: call.status,
    ringUntil: call.ringUntil,
    answeredAt: call.answeredAt ?? null,
    endedAt: call.endedAt ?? null,
    endReason: call.endReason ?? null,
  };
}

/** The DM's two people — the only SSE subscribers that may receive the event. */
const routeOf = (call) => ({
  kind: 'dm', audience: 'members', team: null, teams: [], members: [idOf(call.caller), idOf(call.callee)], archived: false,
});

async function emit(call, type, extra = {}) {
  await publishChatEvent({ type, channelId: idOf(call.channel), call: shapeCall(call), route: routeOf(call), ...extra });
}

/**
 * The servers a browser may use to find a path to the other person. STUN only
 * tells a browser its own public address; TURN (our coturn relay) carries the
 * still-encrypted media when no direct path exists. TURN passwords are minted
 * per person and expire (coturn `use-auth-secret`): username "<expiry>:<userId>",
 * password base64(HMAC-SHA1(secret, username)) — the secret never leaves the server.
 */
export function iceServersFor(user, now = Date.now()) {
  const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
  const stun = list(process.env.CALL_STUN_URLS ?? 'stun:stun.cloudflare.com:3478');
  const servers = stun.length ? [{ urls: stun }] : [];
  const turn = list(process.env.CALL_TURN_URLS);
  const secret = process.env.CALL_TURN_SECRET;
  if (turn.length && secret) {
    const ttl = num(process.env.CALL_TURN_TTL_SECONDS, 6 * 3600);
    const username = `${Math.floor(now / 1000) + ttl}:${idOf(user)}`;
    const credential = crypto.createHmac('sha1', secret).update(username).digest('base64');
    servers.push({ urls: turn, username, credential });
  }
  return servers;
}

/** iceServersFor plus the hosted relay (services/callRelay.js) when it is set up. Never throws. */
export async function callIceServers(user) {
  return [...iceServersFor(user), ...(await cloudflareTurnServers())];
}

// ── ending ───────────────────────────────────────────────────────────────────

/**
 * End a live call — once. `from` limits which states may end this way (a
 * decline only ends a ringing call). Returns the ended call, or null when
 * someone else already ended it (then nothing more happens here).
 */
async function endCall(callId, { from = ['ringing', 'active'], reason, by = null, at = new Date() }) {
  const ended = await chatCallRepository.updateIf(
    { _id: callId, live: true, status: { $in: from } },
    { $set: { live: false, status: 'ended', endedAt: at, endReason: reason, endedBy: by ? idOf(by) : null } },
  );
  if (!ended) return null;
  clearRingTimer(ended._id);
  await emit(ended, 'call.ended');
  // Clear the ringing pop-up on the callee's devices (push-sw.js closes this tag).
  void sendToUsers([{ userId: idOf(ended.callee), url: '/' }], { tag: `call-${idOf(ended)}`, close: true, ttl: 60 });
  try {
    const [caller, callee] = await Promise.all([
      userRepository.findChatPrincipal(ended.caller),
      userRepository.findChatPrincipal(ended.callee),
    ]);
    const durationSec = ended.answeredAt ? (new Date(ended.endedAt) - new Date(ended.answeredAt)) / 1000 : 0;
    await postCallLine(ended.channel, {
      callId: ended._id,
      caller: caller || { _id: ended.caller, name: 'Former member' },
      callee: callee || { _id: ended.callee },
      media: ended.media,
      outcome: reason,
      durationSec,
    });
  } catch (err) {
    // The call is over either way; a lost line is logged, never a stuck call.
    console.error('[calls] call line failed:', err.message);
  }
  return ended;
}

// In-process ring timers. Best effort: the cron sweep is the backstop.
const ringTimers = new Map();
function armRingTimer(call) {
  clearRingTimer(call._id);
  const wait = Math.max(0, new Date(call.ringUntil).getTime() - Date.now()) + 250;
  const t = setTimeout(() => {
    ringTimers.delete(idOf(call));
    void endCall(call._id, { from: ['ringing'], reason: 'missed' }).catch((err) => console.error('[calls] ring timeout failed:', err.message));
  }, wait);
  t.unref?.();
  ringTimers.set(idOf(call), t);
}
function clearRingTimer(callId) {
  const t = ringTimers.get(idOf(callId));
  if (t) { clearTimeout(t); ringTimers.delete(idOf(callId)); }
}

/**
 * End every live call that should already be over: unanswered past its ring,
 * or a side silent past STALE_MS. Run every minute (cronService) and before
 * any decision that depends on who is in a call. Idempotent.
 * @returns {Promise<number>} how many calls it ended
 */
export async function sweepCalls(filter = {}, now = new Date()) {
  const stale = new Date(now.getTime() - STALE_MS);
  const due = await chatCallRepository.findDue(filter, now, stale);
  let n = 0;
  for (const c of due) {
    const done = c.status === 'ringing'
      ? await endCall(c._id, { from: ['ringing'], reason: 'missed', at: now })
      : await endCall(c._id, { from: ['active'], reason: 'failed', at: now });
    if (done) n += 1;
  }
  return n;
}

// ── actions ──────────────────────────────────────────────────────────────────

/**
 * Ring the other person in a one-to-one chat. Idempotent for a double-click
 * (returns the call already ringing), and when both ring each other at once
 * the second press answers the first.
 * @returns {{ call, iceServers, joined: boolean }}
 */
export async function startCall(user, channelId, { media = 'video', deviceId } = {}) {
  checkDevice(deviceId);
  if (!['audio', 'video'].includes(media)) throw fail('Invalid call type', 400);
  const channel = await loadDm(user, channelId);
  const calleeId = (channel.members || []).map(idOf).find((m) => m !== idOf(user));
  const callee = await userRepository.findChatPrincipal(calleeId);
  if (!isChatUser(callee)) throw fail('This person can no longer receive calls', 409);

  // Settle anything already over before deciding who is busy.
  await sweepCalls({ $or: [{ caller: { $in: [user._id, callee._id] } }, { callee: { $in: [user._id, callee._id] } }] });

  const existing = await chatCallRepository.findLiveInChannel(channel._id);
  if (existing) return rejoinOrAnswer(user, existing, deviceId);

  const mine = await chatCallRepository.isOnCall(user._id);
  if (mine) throw fail('You are already on another call', 409, 'SELF_BUSY');
  const theirs = await chatCallRepository.isOnCall(callee._id);
  if (theirs) throw fail(`${callee.name || 'They'} is on another call`, 409, 'BUSY');

  const now = new Date();
  let call;
  try {
    call = await chatCallRepository.create({
      channel: channel._id,
      caller: user._id,
      callee: callee._id,
      media,
      callerDevice: deviceId,
      callerSeenAt: now,
      ringUntil: new Date(now.getTime() + RING_MS),
    });
  } catch (err) {
    if (err?.code !== 11000) throw err;
    // The other person pressed Call at the same instant: join theirs.
    const winner = await chatCallRepository.findLiveInChannel(channel._id);
    if (!winner) throw fail('Could not start the call, try again', 409);
    return rejoinOrAnswer(user, winner, deviceId);
  }

  armRingTimer(call);
  await emit(call, 'call.ring', { caller: { id: idOf(user), name: user.name || '' } });
  void sendToUsers(
    [{ userId: idOf(callee), url: `${chatPath(callee)}?c=${idOf(channel)}&call=${idOf(call)}` }],
    {
      title: `${user.name || 'Someone'} is calling you`,
      body: `${media === 'audio' ? 'Voice' : 'Video'} call — tap to answer`,
      tag: `call-${idOf(call)}`,
      requireInteraction: true,
      // A ring is worth nothing once it has stopped: a phone that comes back
      // online later must not show "is calling you".
      ttl: Math.ceil(RING_MS / 1000),
    },
  );
  return { call: shapeCall(call), iceServers: await callIceServers(user), joined: false };
}

async function rejoinOrAnswer(user, call, deviceId) {
  const side = sideOf(call, user);
  // Both pressed Call: the second press answers the first.
  if (call.status === 'ringing' && side === 'callee') return answerCall(user, idOf(call), { deviceId });
  // Same person again (double-click, or a refresh while ringing / in the call):
  // that tab takes over its side of the call.
  const field = `${side}Device`;
  const updated = await chatCallRepository.updateIf(
    { _id: call._id, live: true },
    { $set: { [field]: deviceId, [`${side}SeenAt`]: new Date() } },
  );
  if (!updated) throw fail('That call has just ended', 409, 'ENDED');
  if (updated.status === 'active') {
    // This tab (a reload keeps its id; another tab has a new one) needs a fresh
    // connection: tell the other side to start over with it.
    await emit(updated, 'call.rejoined', { side });
  }
  return { call: shapeCall(updated), iceServers: await callIceServers(user), joined: true };
}

/** Answer a ringing call, from one tab. Any other tab of the callee stops ringing. */
export async function answerCall(user, callId, { deviceId } = {}) {
  checkDevice(deviceId);
  const call = await loadOwnCall(user, callId);
  if (sideOf(call, user) !== 'callee') throw fail('Only the person called can answer', 403);
  const now = new Date();
  const answered = await chatCallRepository.updateIf(
    { _id: call._id, live: true, status: 'ringing', ringUntil: { $gt: now } },
    { $set: { status: 'active', answeredAt: now, calleeDevice: deviceId, calleeSeenAt: now, callerSeenAt: now } },
  );
  if (!answered) {
    const fresh = await chatCallRepository.findById(call._id);
    if (fresh?.live && fresh.status === 'ringing') {
      await endCall(fresh._id, { from: ['ringing'], reason: 'missed', at: now });
      throw fail('The call stopped ringing', 409, 'ENDED');
    }
    if (fresh?.status === 'active') throw fail('Already answered on another device', 409, 'ANSWERED_ELSEWHERE');
    throw fail('That call has ended', 409, 'ENDED');
  }
  clearRingTimer(answered._id);
  await emit(answered, 'call.answered');
  void sendToUsers([{ userId: idOf(answered.callee), url: '/' }], { tag: `call-${idOf(answered)}`, close: true, ttl: 60 });
  return { call: shapeCall(answered), iceServers: await callIceServers(user), joined: true };
}

/** The person called says no. */
export async function declineCall(user, callId) {
  const call = await loadOwnCall(user, callId);
  if (sideOf(call, user) !== 'callee') throw fail('Only the person called can decline', 403);
  const ended = await endCall(call._id, { from: ['ringing'], reason: 'declined', by: user });
  return { ended: !!ended };
}

/** Either side hangs up: a ringing call is cancelled (caller) or declined (callee); an active one completes. */
export async function hangUpCall(user, callId) {
  const call = await loadOwnCall(user, callId);
  if (!call.live) return { ended: false };
  const side = sideOf(call, user);
  const ended = call.status === 'ringing'
    ? await endCall(call._id, { from: ['ringing'], reason: side === 'caller' ? 'cancelled' : 'declined', by: user })
    : await endCall(call._id, { from: ['active'], reason: 'completed', by: user });
  return { ended: !!ended };
}

/**
 * The request sanitizer (middleware/sanitizationMiddleware.js) trims every string
 * in a body, which strips the CRLF an SDP must end with — and Chrome then refuses
 * the whole offer ("Invalid SDP line"). An SDP never begins with whitespace and
 * its only trailing whitespace is that CRLF, so putting it back restores exactly
 * what the browser sent.
 */
export function withSdpLineEnd(description) {
  if (!description || typeof description !== 'object' || typeof description.sdp !== 'string') return description;
  const { sdp } = description;
  return sdp && !sdp.endsWith('\n') ? { ...description, sdp: `${sdp}\r\n` } : description;
}

/**
 * Pass a connection-setup message to the other person's tab in the call.
 * Only between the call's two people, only from the tab that is in the call,
 * only while it is live.
 */
export async function relaySignal(user, callId, { deviceId, kind, data } = {}) {
  checkDevice(deviceId);
  if (!SIGNAL_KINDS.includes(kind)) throw fail('Invalid signal', 400);
  let size;
  try { size = Buffer.byteLength(JSON.stringify(data ?? null)); } catch { throw fail('Invalid signal', 400); }
  if (data == null || size > MAX_SIGNAL_BYTES) throw fail('Invalid signal', 400);
  const call = await loadOwnCall(user, callId);
  if (!call.live || call.status !== 'active') throw fail('That call has ended', 409, 'ENDED');
  const side = sideOf(call, user);
  if (call[`${side}Device`] !== deviceId) throw fail('This call is open in another tab', 409, 'OTHER_DEVICE');
  const toDevice = call[`${peerSide(side)}Device`];
  await publishChatEvent({
    type: 'call.signal',
    channelId: idOf(call.channel),
    callId: idOf(call),
    fromDevice: deviceId,
    toDevice,
    kind,
    data: kind === 'candidates' ? data : withSdpLineEnd(data),
    route: routeOf(call),
  });
  return { sent: true };
}

/** "I'm still here". Returns the call, so a tab that missed an event learns the call ended. */
export async function heartbeatCall(user, callId, { deviceId } = {}) {
  checkDevice(deviceId);
  const call = await loadOwnCall(user, callId);
  const side = sideOf(call, user);
  if (!call.live) return { call: shapeCall(call) };
  if (call[`${side}Device`] !== deviceId) throw fail('This call is open in another tab', 409, 'OTHER_DEVICE');
  const updated = await chatCallRepository.updateIf(
    { _id: call._id, live: true, [`${side}Device`]: deviceId },
    { $set: { [`${side}SeenAt`]: new Date() } },
  );
  return { call: shapeCall(updated || (await chatCallRepository.findById(call._id))) };
}

/** My live call, if any — so a tab opened (or reloaded) mid-ring or mid-call picks it up. */
export async function myLiveCall(user) {
  await sweepCalls({ $or: [{ caller: user._id }, { callee: user._id }] });
  const call = await chatCallRepository.findLiveFor(user._id);
  if (!call) return { call: null, iceServers: [] };
  const peerId = sideOf(call, user) === 'caller' ? call.callee : call.caller;
  const peer = await userRepository.findChatPrincipal(peerId);
  return { call: shapeCall(call), peer: peer ? { id: idOf(peer), name: peer.name || '' } : null, iceServers: await callIceServers(user) };
}
