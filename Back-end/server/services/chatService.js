/**
 * Team chat — internal messaging for admins and staff (never customers).
 *
 * Access rules live HERE, server-side, and every read and write goes through
 * canAccess(): the client only ever learns about channels it may see. See
 * models/ChatChannel.js for what each `audience` means.
 *
 * Ordering & idempotency:
 *   - each message takes `seq` from an atomic $inc on its channel, so order is
 *     total and gap-free per channel and cursors are plain numbers;
 *   - a send carries a client-generated `clientId`; the same id from the same
 *     sender in the same channel returns the original message instead of
 *     creating a second one (double-click, retry after a network blip).
 */
import mongoose from 'mongoose';
import AppError from '../utils/AppError.js';
import chatRepository from '../repositories/chatRepository.js';
import userRepository from '../repositories/userRepository.js';
import { STAFF_TEAM_LABELS, STAFF_TEAM_VALUES } from '../config/staff.js';
import { publishChatEvent } from './chatEvents.js';

const fail = (message, status) => new AppError(message, status, { expose: true });

export const MESSAGE_MAX_LENGTH = 4000;
export const PAGE_SIZE_DEFAULT = 50;
export const PAGE_SIZE_MAX = 100;

/** The spaces every install has. Team spaces follow config/staff.js. */
export const DEFAULT_SPACES = Object.freeze([
  { key: 'company', name: 'company', audience: 'all', team: null, description: 'Announcements and general talk for the whole company' },
  ...STAFF_TEAM_VALUES.map((team) => ({
    key: `team:${team}`,
    name: team,
    audience: 'team',
    team,
    description: `${STAFF_TEAM_LABELS[team]} team`,
  })),
]);

// ── who is who ───────────────────────────────────────────────────────────────

const idOf = (v) => String(v?._id ?? v);
export const isChatUser = (user) =>
  !!user && (user.role === 'admin' || (user.role === 'staff' && user.staff?.active === true));
const isAdmin = (user) => user?.role === 'admin';
const teamOf = (user) => (user?.role === 'staff' ? user.staff?.team : null);
export const canCreateSpace = (user) => isAdmin(user) || (isChatUser(user) && user.staff?.isHead === true);

/** May `user` read and post in `channel`? */
export function canAccess(user, channel) {
  if (!isChatUser(user) || !channel || channel.archived) return false;
  const uid = idOf(user);
  const isMember = (channel.members || []).some((m) => idOf(m) === uid);
  if (channel.kind === 'dm') return isMember;
  if (channel.audience === 'all') return true;
  if (isAdmin(user)) return true;
  if (channel.audience === 'team') return !!channel.team && teamOf(user) === channel.team;
  return isMember;
}

/** Mongo filter for every channel `user` may see. Mirrors canAccess(). */
function accessFilter(user) {
  const uid = new mongoose.Types.ObjectId(idOf(user));
  if (isAdmin(user)) {
    return { archived: false, $or: [{ kind: 'space' }, { kind: 'dm', members: uid }] };
  }
  return {
    archived: false,
    $or: [
      { audience: 'all' },
      { audience: 'team', team: teamOf(user) },
      { audience: 'members', members: uid },
    ],
  };
}

// ── setup ────────────────────────────────────────────────────────────────────

/** Create the default spaces if any are missing. Idempotent; cheap when done. */
export async function ensureDefaultSpaces() {
  const keys = DEFAULT_SPACES.map((s) => s.key);
  const existing = await chatRepository.countByKeys(keys);
  if (existing === keys.length) return;
  await Promise.all(
    DEFAULT_SPACES.map((s) =>
      chatRepository.upsertByKey(s.key, { ...s, kind: 'space', system: true, members: [], archived: false }).catch((err) => {
        if (err?.code !== 11000) throw err; // a concurrent request created it first
      })
    )
  );
}

// ── shaping ──────────────────────────────────────────────────────────────────

const personOf = (u) =>
  u
    ? {
        id: idOf(u),
        name: u.name || 'Unknown',
        role: u.role,
        team: u.role === 'staff' ? u.staff?.team ?? null : null,
        teamLabel: u.role === 'staff' ? STAFF_TEAM_LABELS[u.staff?.team] ?? null : 'Admin',
        isHead: u.role === 'staff' ? !!u.staff?.isHead : false,
      }
    : null;

function shapeMessage(m, sender) {
  const deleted = !!m.deletedAt;
  return {
    id: idOf(m),
    channelId: idOf(m.channel),
    seq: m.seq,
    kind: m.kind,
    text: deleted ? '' : m.text,
    deleted,
    sender: m.kind === 'system' ? null : personOf(sender ?? m.sender),
    clientId: m.clientId ?? null,
    createdAt: m.createdAt,
  };
}

/** Routing info the SSE layer needs to decide who receives an event. */
const audienceOf = (c) => ({
  kind: c.kind,
  audience: c.audience,
  team: c.team ?? null,
  members: (c.members || []).map(idOf),
  archived: !!c.archived,
});

// ── text ─────────────────────────────────────────────────────────────────────

/** Trim, drop control characters (keep newlines/tabs), collapse runs of blank lines. */
export function cleanText(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

// ── reads ────────────────────────────────────────────────────────────────────

/** Everyone who can chat — for starting DMs and (later) @mentions. */
export async function listPeople() {
  const users = await userRepository.findChatUsers();
  return users.map(personOf);
}

/** Channels visible to `user`, with unread counts and DM partner names. */
export async function listChannels(user) {
  await ensureDefaultSpaces();
  const channels = await chatRepository.findChannels(
    accessFilter(user),
    'kind key name description audience team members system lastMessageSeq lastMessageAt createdBy'
  );

  const ids = channels.map((c) => c._id);
  const reads = await chatRepository.findReadStates(user._id, ids);
  const readBy = new Map(reads.map((r) => [idOf(r.channel), r.lastReadSeq]));

  // Names for DM partners, resolved in one query.
  const uid = idOf(user);
  const partnerIds = new Set();
  for (const c of channels) if (c.kind === 'dm') for (const m of c.members) if (idOf(m) !== uid) partnerIds.add(idOf(m));
  const partners = await userRepository.findDisplayByIds([...partnerIds]);
  const partnerById = new Map(partners.map((p) => [idOf(p), p]));

  const order = new Map(DEFAULT_SPACES.map((s, i) => [s.key, i]));
  return channels
    .map((c) => {
      const lastRead = readBy.get(idOf(c)) ?? 0;
      const partner = c.kind === 'dm'
        ? partnerById.get(c.members.map(idOf).find((m) => m !== uid) ?? '')
        : null;
      return {
        id: idOf(c),
        kind: c.kind,
        key: c.key ?? null,
        name: c.kind === 'dm' ? partner?.name ?? 'Former member' : c.name,
        description: c.description || '',
        audience: c.audience,
        team: c.team ?? null,
        system: !!c.system,
        partner: c.kind === 'dm' ? personOf(partner) : null,
        memberCount: c.audience === 'members' ? c.members.length : null,
        lastMessageSeq: c.lastMessageSeq,
        lastMessageAt: c.lastMessageAt,
        lastReadSeq: lastRead,
        unread: Math.max(0, c.lastMessageSeq - lastRead),
      };
    })
    .sort((a, b) => {
      // System spaces first in their fixed order, then everything else by activity.
      const oa = a.key != null && order.has(a.key) ? order.get(a.key) : Infinity;
      const ob = b.key != null && order.has(b.key) ? order.get(b.key) : Infinity;
      if (oa !== ob) return oa - ob;
      return new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0);
    });
}

async function loadAccessible(user, channelId) {
  if (!mongoose.isValidObjectId(channelId)) throw fail('Channel not found', 404);
  const channel = await chatRepository.findChannelById(channelId);
  // 404 for "exists but not yours" too — never confirm a private channel exists.
  if (!channel || !canAccess(user, channel)) throw fail('Channel not found', 404);
  return channel;
}

/**
 * A page of messages, oldest → newest.
 *   before=<seq>  older history (scrolling up); default = the latest page
 *   after=<seq>   catch-up after a reconnect
 */
export async function listMessages(user, channelId, { before, after, limit } = {}) {
  const channel = await loadAccessible(user, channelId);
  const size = Math.min(Math.max(parseInt(limit, 10) || PAGE_SIZE_DEFAULT, 1), PAGE_SIZE_MAX);

  let docs;
  if (after != null && after !== '') {
    docs = await chatRepository.findMessagesAfter(channel._id, Number(after), size);
  } else {
    const cursor = before != null && before !== '' ? Number(before) : null;
    docs = (await chatRepository.findMessagesBefore(channel._id, cursor, size)).reverse();
  }

  const oldest = docs[0]?.seq;
  return {
    messages: docs.map((m) => shapeMessage(m)),
    // Cursor for the next older page, or null when the beginning is reached.
    nextBefore: after == null || after === '' ? (oldest > 1 ? oldest : null) : undefined,
  };
}

// ── writes ───────────────────────────────────────────────────────────────────

async function markRead(userId, channelId, seq) {
  await chatRepository.advanceRead(userId, channelId, seq).catch((err) => {
    if (err?.code !== 11000) throw err; // concurrent first read — the other upsert won
  });
}

/** Post a message. Idempotent on (channel, sender, clientId). */
export async function sendMessage(user, channelId, { text, clientId } = {}) {
  const channel = await loadAccessible(user, channelId);
  const body = cleanText(text);
  if (!body) throw fail('Message cannot be empty', 400);
  if (body.length > MESSAGE_MAX_LENGTH) throw fail(`Message is too long (max ${MESSAGE_MAX_LENGTH} characters)`, 400);

  if (clientId) {
    const existing = await chatRepository.findByClientId(channel._id, user._id, clientId);
    if (existing) return { message: shapeMessage(existing), duplicate: true };
  }

  return insertMessage(channel, { kind: 'user', sender: user, text: body, clientId });
}

async function insertMessage(channel, { kind, sender, text, clientId }) {
  const seq = await chatRepository.nextSeq(channel._id, new Date());
  if (seq == null) throw fail('Channel not found', 404);

  let doc;
  try {
    doc = await chatRepository.createMessage({
      channel: channel._id,
      seq,
      kind,
      sender: sender?._id ?? null,
      text,
      ...(clientId ? { clientId } : {}),
    });
  } catch (err) {
    // Same clientId raced in from a parallel request: return the winner. The seq
    // we took stays unused — harmless, readers never assume seqs are contiguous.
    if (err?.code === 11000 && clientId) {
      const existing = await chatRepository.findByClientId(channel._id, sender._id, clientId);
      if (existing) return { message: shapeMessage(existing), duplicate: true };
    }
    throw err;
  }

  if (sender) await markRead(sender._id, channel._id, seq); // your own message is never "unread"

  const message = shapeMessage(doc, sender);
  await publishChatEvent({ type: 'message', channelId: idOf(channel), route: audienceOf(channel), message });
  return { message, duplicate: false };
}

/**
 * Post an automatic message from the system into a default space (e.g. 'team:operations').
 * Used by business events (new paid order, refund request…). Never throws: a chat
 * hiccup must not fail the business operation that triggered it.
 */
export async function postSystemMessage(spaceKey, text) {
  try {
    await ensureDefaultSpaces();
    const channel = await chatRepository.findChannelByKey(spaceKey);
    const body = cleanText(text).slice(0, MESSAGE_MAX_LENGTH);
    if (!channel || !body) return null;
    const { message } = await insertMessage(channel, { kind: 'system', sender: null, text: body });
    return message;
  } catch (err) {
    console.error(`[chat] system message to ${spaceKey} failed:`, err.message);
    return null;
  }
}

/** Mark everything up to `seq` as read. */
export async function markChannelRead(user, channelId, seq) {
  const channel = await loadAccessible(user, channelId);
  const upTo = Math.min(Math.max(Number(seq) || 0, 0), channel.lastMessageSeq);
  await markRead(user._id, channel._id, upTo);
  return { lastReadSeq: upTo };
}

/** Soft-delete: the sender or an admin. The row is kept for the record. */
export async function deleteMessage(user, messageId) {
  if (!mongoose.isValidObjectId(messageId)) throw fail('Message not found', 404);
  const msg = await chatRepository.findMessageById(messageId);
  if (!msg) throw fail('Message not found', 404);
  const channel = await loadAccessible(user, msg.channel); // also hides other people's DMs
  const isOwn = msg.sender && idOf(msg.sender) === idOf(user);
  if (!isOwn && !isAdmin(user)) throw fail('You can only delete your own messages', 403);
  if (msg.deletedAt) return { id: idOf(msg), deleted: true };

  await chatRepository.softDeleteMessage(msg._id, user._id);
  await publishChatEvent({
    type: 'message_deleted',
    channelId: idOf(channel),
    route: audienceOf(channel),
    messageId: idOf(msg),
  });
  return { id: idOf(msg), deleted: true };
}

/** New custom space. Admins and team heads only; the creator is always a member. */
export async function createSpace(user, { name, description, memberIds } = {}) {
  if (!canCreateSpace(user)) throw fail('Only admins and team heads can create spaces', 403);
  const cleanName = cleanText(name).toLowerCase().replace(/^#/, '').replace(/\s+/g, '-').slice(0, 60);
  if (cleanName.length < 2) throw fail('Space name must be at least 2 characters', 400);

  const reserved = new Set(DEFAULT_SPACES.map((s) => s.name));
  if (reserved.has(cleanName)) throw fail('That name is already used by a default space', 409);
  const clash = await chatRepository.spaceNameTaken(cleanName);
  if (clash) throw fail('A space with that name already exists', 409);

  const requested = Array.isArray(memberIds) ? memberIds.filter((id) => mongoose.isValidObjectId(id)) : [];
  const valid = await userRepository.findChatUsersByIds(requested);
  const members = [...new Set([idOf(user), ...valid.map(idOf)])];

  const channel = await chatRepository.createChannel({
    kind: 'space',
    name: cleanName,
    description: cleanText(description).slice(0, 240),
    audience: 'members',
    members,
    createdBy: user._id,
  });
  await publishChatEvent({ type: 'channel', channelId: idOf(channel), route: audienceOf(channel) });
  return { id: idOf(channel), name: channel.name };
}

/** Get or create the DM between `user` and `otherId`. */
export async function openDirectMessage(user, otherId) {
  if (!mongoose.isValidObjectId(otherId)) throw fail('Person not found', 404);
  if (idOf(user) === String(otherId)) throw fail('You cannot message yourself', 400);
  const [other] = await userRepository.findChatUsersByIds([otherId]);
  if (!other) throw fail('Person not found', 404);

  const pair = [idOf(user), idOf(other)].sort();
  const key = `dm:${pair[0]}:${pair[1]}`;
  let channel = await chatRepository.findChannelByKey(key);
  if (!channel) {
    try {
      channel = await chatRepository.createChannel({ kind: 'dm', key, audience: 'members', members: pair });
      await publishChatEvent({ type: 'channel', channelId: idOf(channel), route: audienceOf(channel) });
    } catch (err) {
      if (err?.code !== 11000) throw err;
      channel = await chatRepository.findChannelByKey(key); // the other person opened it at the same moment
    }
  }
  return { id: idOf(channel) };
}
