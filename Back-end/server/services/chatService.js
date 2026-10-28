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
import { pushConfigured, sendToUsers } from './pushService.js';
import { onlineAmong } from './chatPresence.js';
import { uploadChatAttachments, MAX_ATTACHMENTS_PER_MESSAGE, CHAT_FILE_NAME, chatFolder, chatFileType } from './chatAttachmentService.js';
import { readPrivateAsset } from './storage/privateUploads.js';
import orderRepository from '../repositories/orderRepository.js';
import emailHandler from './emailHandler.js';
import { orderNumber } from './invoiceService.js';

const fail = (message, status) => new AppError(message, status, { expose: true });

export const MESSAGE_MAX_LENGTH = 4000;

/**
 * How long after sending its author may still edit or delete a message.
 *
 * Long enough to catch a typo, the wrong channel or a half-sent thought; short
 * enough that a conversation people have already acted on cannot be rewritten
 * under them. Enforced by the database write itself (chatRepository
 * editOwnMessage / deleteOwnMessage), not by a check that could race the clock.
 */
export const CHAT_EDIT_WINDOW_MS = 30 * 60 * 1000;
export const PAGE_SIZE_DEFAULT = 50;
export const PAGE_SIZE_MAX = 100;

/**
 * Every pair of teams, sorted, once each: the private team-to-team conversations.
 * A key is 'pair:<a>:<b>' with a < b, so both sides converge on one channel.
 */
export const TEAM_PAIRS = Object.freeze(
  STAFF_TEAM_VALUES.flatMap((a, i) => STAFF_TEAM_VALUES.slice(i + 1).map((b) => [a, b].sort())),
);
const pairKey = ([a, b]) => `pair:${a}:${b}`;

/** The spaces every install has. Team spaces and team pairs follow config/staff.js. */
export const DEFAULT_SPACES = Object.freeze([
  { key: 'company', name: 'company', audience: 'all', team: null, description: 'Announcements and general talk for the whole company' },
  ...STAFF_TEAM_VALUES.map((team) => ({
    key: `team:${team}`,
    name: team,
    audience: 'team',
    team,
    description: `${STAFF_TEAM_LABELS[team]} team`, // stored once; listChannels shows the current label
  })),
  ...TEAM_PAIRS.map((pair) => ({
    key: pairKey(pair),
    name: pair.join('-'),
    audience: 'teams',
    team: null,
    teams: pair,
    description: pair.map((t) => STAFF_TEAM_LABELS[t]).join(' ↔ '),
  })),
]);

/**
 * What a space is called on screen. A team space is named after its team's
 * label, so the 'sales' team's space reads #gtm — without renaming the stored
 * channel, which existing links and history point at.
 */
const spaceDisplayName = (c) => (c.system && typeof c.key === 'string' && c.key.startsWith('team:')
  ? (STAFF_TEAM_LABELS[c.team] || c.name).toLowerCase()
  : c.name);

/**
 * A team-to-team conversation is named from where the reader sits: Procurement
 * sees "Accounts", Accounts sees "Procurement", an admin sees both sides. Team
 * labels as written ("GTM"), not #lowercase — these are teams, not spaces.
 */
function channelNameFor(c, user) {
  if (c.audience !== 'teams') return spaceDisplayName(c);
  const labels = (c.teams || []).map((t) => STAFF_TEAM_LABELS[t] || t);
  const mine = teamOf(user);
  if (mine && (c.teams || []).includes(mine)) {
    const other = (c.teams || []).find((t) => t !== mine);
    return STAFF_TEAM_LABELS[other] || other || c.name;
  }
  return labels.join(' ↔ ');
}

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
  // Team-to-team: both whole teams, nobody else (admins are handled above).
  if (channel.audience === 'teams') return Array.isArray(channel.teams) && channel.teams.includes(teamOf(user));
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
      { audience: 'teams', teams: teamOf(user) },
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

/**
 * A message as `viewer` may see it.
 *
 * Admins see EVERY message: a deleted one keeps its text and files (flagged
 * `deleted`), and an edited one carries its earlier versions. Everyone else
 * gets a deleted message emptied and an edited one with only its current text.
 *
 * ⚠ Anything BROADCAST over the live stream must be shaped with no viewer:
 * one payload goes to everyone in the channel, so it must be the version the
 * least-privileged reader may see. Only a response to one person's own request
 * (a page, a thread, a search) is shaped for that person.
 */
function shapeMessage(m, sender, viewer = null) {
  const deleted = !!m.deletedAt;
  const admin = isAdmin(viewer);
  const hide = deleted && !admin;
  return {
    id: idOf(m),
    channelId: idOf(m.channel),
    seq: m.seq,
    kind: m.kind,
    text: hide ? '' : m.text,
    deleted,
    sender: m.kind === 'system' ? null : personOf(sender ?? m.sender),
    clientId: m.clientId ?? null,
    // A deleted message takes its attachments and references with it — for
    // everyone but an admin.
    attachments: hide ? [] : (m.attachments || []).map((a) => ({
      url: a.url, kind: a.kind, name: a.name, mime: a.mime, size: a.size,
    })),
    mentions: (m.mentions || []).map(idOf),
    mentionTeams: m.mentionTeams || [],
    refs: hide ? [] : (m.refs || []).map((r) => ({ type: r.type, code: r.code, id: idOf(r.target) })),
    quote: shapeQuote(m.quote, hide, admin),
    reactions: hide ? [] : shapeReactions(m.reactions),
    createdAt: m.createdAt,
    edited: !!m.editedAt,
    editedAt: m.editedAt ?? null,
    // The client shows Edit / Delete until then; the server enforces it. A
    // system post has no author, so it is never anyone's to change.
    editableUntil: m.kind === 'user' && !deleted
      ? new Date(new Date(m.createdAt).getTime() + CHAT_EDIT_WINDOW_MS)
      : null,
    ...(admin && deleted ? { deletedAt: m.deletedAt } : {}),
    ...(admin && m.editHistory?.length
      ? { editHistory: m.editHistory.map((h) => ({ text: h.text, editedAt: h.editedAt })) }
      : {}),
    ...threadFieldsOf(m),
  };
}

/**
 * The quote a message carries. A quote of a since-deleted message keeps its
 * snapshot in the database, but only an admin is shown the words.
 */
function shapeQuote(q, hidden, admin) {
  if (hidden || !q) return null;
  const withheld = q.deleted && !admin;
  return {
    id: idOf(q.message),
    seq: q.seq,
    by: q.by,
    preview: withheld ? '' : q.preview,
    deleted: !!q.deleted,
  };
}

/** Reactions as the client draws them: the emoji, how many, and who. */
function shapeReactions(list) {
  return (list || [])
    .filter((r) => r.users?.length)
    .map((r) => ({ emoji: r.emoji, count: r.users.length, userIds: r.users.map(idOf) }));
}

/** Where a message sits in a thread, and — for a root — what its thread holds. */
function threadFieldsOf(m) {
  return {
    threadRoot: m.threadRoot ? idOf(m.threadRoot) : null,
    // Older messages predate activitySeq; their own seq is the same thing.
    activitySeq: m.threadRoot ? null : (m.activitySeq ?? m.seq),
    replyCount: m.replyCount || 0,
    lastReply: m.replyCount
      ? {
          at: m.lastReplyAt,
          by: m.lastReplyBy || '',
          preview: m.lastReplyPreview || '',
          mentions: (m.lastReplyMentions || []).map(idOf),
        }
      : null,
  };
}

/** Routing info the SSE layer needs to decide who receives an event. */
const audienceOf = (c) => ({
  kind: c.kind,
  audience: c.audience,
  team: c.team ?? null,
  teams: c.teams ?? [],
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
    'kind key name description audience team teams members system lastMessageSeq lastMessageAt createdBy'
  );

  const ids = channels.map((c) => c._id);
  const reads = await chatRepository.findReadStates(user._id, ids);
  // Per tab: Chat and Order updates are read separately (models/ChatReadState.js).
  const readBy = new Map(reads.map((r) => [idOf(r.channel), {
    chat: r.lastReadSeq ?? 0,
    updates: r.lastReadUpdatesSeq ?? r.lastReadSeq ?? 0,
  }]));
  const readOf = (c) => readBy.get(idOf(c)) ?? { chat: 0, updates: 0 };
  // Count only where something is past a read position — usually a handful of channels.
  const unreadRows = await chatRepository.countUnreadByLane(channels
    .filter((c) => c.lastMessageSeq > Math.min(readOf(c).chat, readOf(c).updates))
    .map((c) => ({ channel: c._id, chatFrom: readOf(c).chat, updatesFrom: readOf(c).updates })));
  const unreadBy = new Map();
  for (const r of unreadRows) {
    const key = idOf(r._id.channel);
    const u = unreadBy.get(key) ?? { chat: 0, updates: 0 };
    u[r._id.updates ? 'updates' : 'chat'] += r.n;
    unreadBy.set(key, u);
  }

  // Names for DM partners, resolved in one query.
  const uid = idOf(user);
  const partnerIds = new Set();
  for (const c of channels) if (c.kind === 'dm') for (const m of c.members) if (idOf(m) !== uid) partnerIds.add(idOf(m));
  const partners = await userRepository.findDisplayByIds([...partnerIds]);
  const partnerById = new Map(partners.map((p) => [idOf(p), p]));

  const order = new Map(DEFAULT_SPACES.map((s, i) => [s.key, i]));
  return channels
    .map((c) => {
      const read = readOf(c);
      const unread = unreadBy.get(idOf(c)) ?? { chat: 0, updates: 0 };
      const partner = c.kind === 'dm'
        ? partnerById.get(c.members.map(idOf).find((m) => m !== uid) ?? '')
        : null;
      return {
        id: idOf(c),
        kind: c.kind,
        key: c.key ?? null,
        name: c.kind === 'dm' ? partner?.name ?? 'Former member' : channelNameFor(c, user),
        description: c.audience === 'teams'
          ? (c.teams || []).map((t) => STAFF_TEAM_LABELS[t] || t).join(' ↔ ')
          : c.system && c.team ? `${STAFF_TEAM_LABELS[c.team] || c.team} team` : c.description || '',
        audience: c.audience,
        team: c.team ?? null,
        // The OTHER team, from where this person sits (null for admins and non-pair channels).
        withTeam: c.audience === 'teams' && (c.teams || []).includes(teamOf(user))
          ? (c.teams || []).find((t) => t !== teamOf(user)) ?? null
          : null,
        system: !!c.system,
        partner: c.kind === 'dm' ? personOf(partner) : null,
        memberCount: c.audience === 'members' ? c.members.length : null,
        // Custom group: may this person add / remove members? (the admin, or whoever created it)
        canManageMembers: c.kind === 'space' && c.audience === 'members' && mayManageMembers(user, c),
        lastMessageSeq: c.lastMessageSeq,
        lastMessageAt: c.lastMessageAt,
        lastReadSeq: read.chat,
        lastReadUpdatesSeq: read.updates,
        unreadChat: unread.chat,
        unreadUpdates: unread.updates,
        unread: unread.chat + unread.updates,
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
 * The bytes of a file shared in a channel (private storage). Same rule as
 * reading the messages: 404 unless the reader may see the channel.
 */
export async function readChatFile(user, channelId, name) {
  const channel = await loadAccessible(user, channelId);
  const type = CHAT_FILE_NAME.test(String(name)) ? chatFileType(name) : null;
  if (!type) throw fail('File not found', 404);
  let buffer;
  try {
    buffer = await readPrivateAsset({ publicId: `${chatFolder(idOf(channel))}/${name}`, provider: 'r2' });
  } catch {
    throw fail('File not found', 404);
  }
  return { buffer, mime: type.mime, inline: type.kind === 'image' || type.mime === 'application/pdf' };
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
    // The timeline: top-level messages, by latest activity in their thread.
    const cursor = before != null && before !== '' ? Number(before) : null;
    docs = (await chatRepository.findTimelineBefore(channel._id, cursor, size)).reverse();
  }

  const oldest = docs[0] ? (docs[0].activitySeq ?? docs[0].seq) : null;
  return {
    messages: docs.map((m) => shapeMessage(m, null, user)),
    // Cursor for the next older page (an activitySeq), or null at the beginning.
    nextBefore: after == null || after === '' ? (docs.length === size && oldest > 1 ? oldest : null) : undefined,
  };
}

/** Bounded page of a thread: the root, and its replies oldest first. */
export const THREAD_PAGE_MAX = 100;

/**
 * One thread. The root decides access: a thread is readable exactly when its
 * channel is, and "not yours" is a 404 like everywhere else in chat.
 *   after=<seq>  replies newer than this (paging forward / catching up)
 */
export async function getThread(user, rootId, { after, limit } = {}) {
  if (!mongoose.isValidObjectId(rootId)) throw fail('Thread not found', 404);
  const root = await chatRepository.findMessageWithSender(rootId);
  if (!root || root.threadRoot) throw fail('Thread not found', 404);
  await loadAccessible(user, root.channel);
  const size = Math.min(Math.max(parseInt(limit, 10) || THREAD_PAGE_MAX, 1), THREAD_PAGE_MAX);
  const from = after != null && after !== '' ? Number(after) : null;
  const replies = await chatRepository.findThreadReplies(root._id, from, size);
  return {
    root: shapeMessage(root, null, user),
    replies: replies.map((m) => shapeMessage(m, null, user)),
    nextAfter: replies.length === size ? replies[replies.length - 1].seq : null,
  };
}

/**
 * The message being quoted, snapshotted. It must be a live message in the SAME
 * channel: quoting from another conversation would copy its text to people who
 * cannot read it. "Not here" is a 404, like every other chat lookup.
 */
async function loadQuote(channel, quoteId) {
  if (!quoteId) return null;
  if (!mongoose.isValidObjectId(quoteId)) throw fail('Quoted message not found', 404);
  const q = await chatRepository.findMessageWithSender(quoteId);
  if (!q || idOf(q.channel) !== idOf(channel) || q.deletedAt) throw fail('Quoted message not found', 404);
  const preview = (q.text || ((q.attachments || []).length ? 'Shared a file' : '')).slice(0, 200);
  return { message: q._id, seq: q.seq, by: q.kind === 'system' ? 'Roavion updates' : q.sender?.name || '', preview };
}

/** A reply needs a live top-level message in the same channel to hang from. */
async function loadThreadRoot(channel, rootId) {
  if (!rootId) return null;
  if (!mongoose.isValidObjectId(rootId)) throw fail('Thread not found', 404);
  const root = await chatRepository.findMessageById(rootId);
  if (!root || idOf(root.channel) !== idOf(channel)) throw fail('Thread not found', 404);
  if (root.threadRoot) throw fail('Reply to the thread itself, not to a reply', 400);
  return root;
}

/**
 * Search message text across every channel the caller may see.
 *
 * ── Why the channel list is resolved first ──────────────────────────────────
 * Search is the one place where a mistake leaks the WHOLE history rather than
 * one message: a query that forgot to scope by channel would happily return
 * another team's space or somebody else's DM. So the accessible channels are
 * resolved from the same `accessFilter` the channel list uses, and the ids are
 * handed to the query — there is no code path here that searches without them.
 *
 * ── Pagination ──────────────────────────────────────────────────────────────
 * Keyset on `createdAt`, newest first, bounded. Chat history only grows, and
 * `skip` over it degrades linearly while duplicating rows whenever someone
 * posts mid-scroll. Mongo cannot use an index to sort a $text match, so the
 * sort happens in memory over the matches — hence the hard page ceiling and
 * the two-character minimum, which together keep that set small.
 *
 * @param {object} user
 * @param {object} opts
 * @param {string} opts.q         what to search for
 * @param {string} [opts.channelId] restrict to one channel
 * @param {string} [opts.before]  ISO date cursor — results older than this
 * @param {number} [opts.limit]
 */
export async function searchMessages(user, { q, channelId, before, limit } = {}) {
  const term = String(q || '').trim();
  // Two characters matches most of the history and helps nobody; the client
  // should not fire until then either, but the server does not rely on that.
  if (term.length < 2) return { messages: [], nextBefore: null };

  const size = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 50);

  let channelIds;
  if (channelId) {
    // Reuses the single-channel access check, so a search scoped to a channel
    // the caller cannot see 404s exactly as reading it would.
    const channel = await loadAccessible(user, channelId);
    channelIds = [channel._id];
  } else {
    const channels = await chatRepository.findChannels(accessFilter(user), '_id name kind');
    channelIds = channels.map((c) => c._id);
  }
  if (!channelIds.length) return { messages: [], nextBefore: null };

  const cursor = before ? new Date(before) : null;
  let docs;
  try {
    docs = await chatRepository.searchMessages(
      channelIds,
      term,
      { before: cursor && !Number.isNaN(cursor.getTime()) ? cursor : null, limit: size },
    );
  } catch (err) {
    // Production runs autoIndex: false, so between a deploy and the index-drift
    // run the text index does not exist yet and Mongo refuses $text outright.
    // That window should read as "search isn't ready", not as a crash.
    if (err?.code === 27 || /text index required/i.test(err?.message || '')) {
      throw fail('Search is still being set up. Please try again shortly.', 503);
    }
    throw err;
  }

  // The channel name travels with each hit: a result list spans channels, and
  // "which conversation was this in?" is the first thing a reader asks.
  //
  // A DM has no name of its own — it is named after whoever else is in it, so
  // the label differs per viewer, exactly as in listChannels(). Resolving it
  // here keeps a DM hit from arriving with a blank label, and only the partners
  // of channels that actually produced a hit are looked up.
  const hitChannels = new Set(docs.map((m) => String(m.channel)));
  const found = (await chatRepository.findChannels(
    { _id: { $in: channelIds.filter((id) => hitChannels.has(String(id))) } },
    '_id name kind members',
  ));

  const uid = idOf(user);
  const partnerIds = new Set();
  for (const c of found) {
    if (c.kind === 'dm') for (const m of c.members || []) if (idOf(m) !== uid) partnerIds.add(idOf(m));
  }
  const partnerById = new Map(
    (await userRepository.findDisplayByIds([...partnerIds])).map((p) => [idOf(p), p]),
  );

  const names = new Map(
    found.map((c) => {
      if (c.kind !== 'dm') return [String(c._id), { name: spaceDisplayName(c), kind: c.kind }];
      const partner = partnerById.get((c.members || []).map(idOf).find((m) => m !== uid) ?? '');
      return [String(c._id), { name: partner?.name ?? 'Former member', kind: 'dm' }];
    }),
  );

  return {
    messages: docs.map((m) => ({
      ...shapeMessage(m, null, user),
      channel: String(m.channel),
      channelName: names.get(String(m.channel))?.name ?? '',
      channelKind: names.get(String(m.channel))?.kind ?? 'space',
    })),
    // Null when the page came back short — there is nothing older to ask for.
    nextBefore: docs.length === size ? docs[docs.length - 1].createdAt : null,
  };
}

/**
 * Recent orders for the "attach an order" picker. Deliberately a bounded, newest-first
 * read on an indexed field — never a text scan over a growing collection. `q` filters
 * that page in memory, which is right for a picker: anything older is reached by
 * opening the order itself.
 */
export async function listRecentOrders(q) {
  const orders = await orderRepository.find(
    { paymentStatus: 'paid' },
    { sort: { createdAt: -1 }, limit: 40, select: '_id wpId totalAmount status createdAt shippingAddress.fullName' },
  );
  const term = String(q || '').trim().toLowerCase();
  return (orders || [])
    .map((o) => ({
      id: idOf(o),
      code: orderNumber(o),
      customer: o.shippingAddress?.fullName || 'Customer',
      total: o.totalAmount,
      status: o.status,
      placedAt: o.createdAt,
    }))
    .filter((o) => !term || o.code.toLowerCase().includes(term) || o.customer.toLowerCase().includes(term))
    .slice(0, 20);
}

/** The channel's Files tab: newest shared photos and documents. */
export async function listFiles(user, channelId, { before, limit } = {}) {
  const channel = await loadAccessible(user, channelId);
  const size = Math.min(Math.max(parseInt(limit, 10) || 30, 1), PAGE_SIZE_MAX);
  const docs = await chatRepository.findMessagesWithFiles(channel._id, before, size, { includeDeleted: isAdmin(user) });
  const files = docs.flatMap((m) =>
    (m.attachments || []).map((a, i) => ({
      id: `${idOf(m)}-${i}`,
      messageId: idOf(m),
      seq: m.seq,
      // Only ever true for an admin — nobody else is shown a deleted file.
      deleted: !!m.deletedAt,
      url: a.url,
      kind: a.kind,
      name: a.name,
      mime: a.mime,
      size: a.size,
      sharedBy: personOf(m.sender),
      sharedAt: m.createdAt,
    })),
  );
  return { files, nextBefore: docs.length === size ? docs[docs.length - 1].createdAt : null };
}

// ── writes ───────────────────────────────────────────────────────────────────

async function markRead(userId, channelId, seq, part = 'all') {
  await chatRepository.advanceRead(userId, channelId, seq, part).catch((err) => {
    if (err?.code !== 11000) throw err; // concurrent first read — the other upsert won
  });
}

/** Post a message. Idempotent on (channel, sender, clientId). */
export async function sendMessage(user, channelId, { text, clientId, mentions, mentionTeams, orderIds, files, threadRoot, quoteId } = {}) {
  const channel = await loadAccessible(user, channelId);
  // Before any upload: a reply to a thread that is not there must not leave files behind.
  const root = await loadThreadRoot(channel, threadRoot);
  const quote = await loadQuote(channel, quoteId);
  const body = cleanText(text);
  const hasFiles = Array.isArray(files) && files.length > 0;
  // A photo on its own is a perfectly good message; only an empty one is refused.
  if (!body && !hasFiles) throw fail('Message cannot be empty', 400);
  if (body.length > MESSAGE_MAX_LENGTH) throw fail(`Message is too long (max ${MESSAGE_MAX_LENGTH} characters)`, 400);
  if (hasFiles && files.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    throw fail(`You can attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} files at a time`, 400);
  }

  // Idempotency first: a retry must not upload the same photo twice.
  if (clientId) {
    const existing = await chatRepository.findByClientId(channel._id, user._id, clientId);
    if (existing) return { message: shapeMessage(existing), duplicate: true };
  }

  const [people, teams] = await resolveMentions(channel, mentions, mentionTeams);
  const refs = await resolveOrderRefs(orderIds);
  const attachments = hasFiles ? await uploadChatAttachments(files, { channelId: idOf(channel) }) : [];

  const result = await insertMessage(channel, {
    kind: 'user', sender: user, text: body, clientId,
    attachments, mentions: people, mentionTeams: teams, refs, threadRoot: root, quote,
  });
  if (!result.duplicate) notifyMentions(channel, user, result.message, people, teams);
  return result;
}

/**
 * Keep only mentions the channel can actually see — mentioning someone must
 * never tell them a private space exists, nor email them about it.
 */
async function resolveMentions(channel, mentions, mentionTeams) {
  const ids = [...new Set((Array.isArray(mentions) ? mentions : []).filter((id) => mongoose.isValidObjectId(id)).map(String))].slice(0, 50);
  const candidates = ids.length ? await userRepository.findChatUsersByIds(ids) : [];
  const allowed = candidates.filter((u) => canAccess(u, channel)).map((u) => u._id);

  const teams = [...new Set((Array.isArray(mentionTeams) ? mentionTeams : []).map(String))]
    .filter((t) => STAFF_TEAM_VALUES.includes(t))
    // Only meaningful where the whole team is present: their own space, #company,
    // or a team-to-team conversation that team is part of.
    .filter((t) => channel.audience === 'all' || channel.audience === 'team'
      || (channel.audience === 'teams' && (channel.teams || []).includes(t)))
    .slice(0, 5);

  return [allowed, teams];
}

/** Orders referenced by id (picked in the UI). Looked up by _id, never scanned. */
async function resolveOrderRefs(orderIds) {
  const ids = [...new Set((Array.isArray(orderIds) ? orderIds : []).filter((id) => mongoose.isValidObjectId(id)).map(String))].slice(0, 5);
  if (!ids.length) return [];
  const orders = await orderRepository.find({ _id: { $in: ids } }, { select: '_id wpId', limit: ids.length });
  return (orders || []).map((o) => ({ type: 'order', code: orderNumber(o), target: o._id }));
}

/**
 * Email the people addressed who do NOT have chat open. Fire-and-forget: chat
 * has already accepted the message, so a mail problem must not fail the send.
 */
function notifyMentions(channel, sender, message, people, teams) {
  (async () => {
    const direct = people.map(String);
    const fromTeams = teams.length
      ? (await userRepository.findChatUsers())
          .filter((u) => u.role === 'staff' && teams.includes(u.staff?.team))
          .map((u) => idOf(u))
      : [];
    const targets = [...new Set([...direct, ...fromTeams])].filter((id) => id !== idOf(sender));
    if (!targets.length) return;

    const online = await onlineAmong(targets);
    const offline = targets.filter((id) => !online.has(id));
    if (!offline.length) return;

    const users = (await userRepository.findContactsByIds(offline)).filter((u) => u.email);
    const where = channel.kind === 'dm' ? 'a direct message' : `#${channel.name}`;
    const link = `${(process.env.FRONTEND_URL || '').replace(/\/$/, '')}/team/chat?c=${idOf(channel)}`;
    const preview = message.text.slice(0, 300) || '(shared a file)';
    await Promise.all(users.map((u) => emailHandler.sendEmail({
      to: u.email,
      subject: `${sender.name} mentioned you in ${where}`,
      text: `${sender.name} mentioned you in ${where} on team chat:\n\n${preview}\n\nOpen team chat: ${link}`,
    }).catch(() => {})));
  })().catch((err) => console.error('[chat] mention notification failed:', err.message));
}

async function insertMessage(channel, {
  kind, sender, text, clientId, attachments = [], mentions = [], mentionTeams = [], refs = [], threadRoot = null, threadOrder, quote = null,
}) {
  const at = new Date();
  const seq = await chatRepository.nextSeq(channel._id, at);
  if (seq == null) throw fail('Channel not found', 404);
  // Shown in the Order updates tab: an automatic post, or a reply in its thread.
  const updates = kind === 'system' || threadRoot?.kind === 'system' || threadRoot?.lane === 'updates';

  let doc;
  try {
    doc = await chatRepository.createMessage({
      channel: channel._id,
      seq,
      kind,
      ...(updates ? { lane: 'updates' } : {}),
      sender: sender?._id ?? null,
      text,
      attachments,
      mentions,
      mentionTeams,
      refs,
      ...(threadRoot ? { threadRoot: threadRoot._id } : { activitySeq: seq }),
      ...(threadOrder ? { threadOrder } : {}),
      ...(clientId ? { clientId } : {}),
      ...(quote ? { quote } : {}),
    });
  } catch (err) {
    // Same clientId raced in from a parallel request: return the winner. The seq
    // we took stays unused — harmless, readers never assume seqs are contiguous.
    if (err?.code === 11000 && clientId) {
      const existing = await chatRepository.findByClientId(channel._id, sender?._id ?? null, clientId);
      if (existing) return { message: shapeMessage(existing), duplicate: true };
    }
    throw err;
  }

  // Your own message is never "unread" — in the tab it was written in.
  if (sender) await markRead(sender._id, channel._id, seq, updates ? 'updates' : 'chat');

  const message = shapeMessage(doc, sender);
  // A reply moves its thread: the root's summary and position travel with the
  // event, so every open timeline can bring the thread back to the bottom.
  let thread = null;
  if (threadRoot) {
    const root = await chatRepository.bumpThread(threadRoot._id, {
      seq,
      at,
      preview: (text || (attachments.length ? 'Shared a file' : '')).slice(0, 200),
      by: kind === 'system' ? 'Roavion updates' : sender?.name || '',
      mentions,
    });
    if (root) thread = shapeMessage(root);
  }
  await publishChatEvent({
    type: 'message', channelId: idOf(channel), route: audienceOf(channel), message, ...(thread ? { thread } : {}),
  });
  // A pop-up on the devices of everyone who can see it — not awaited: chat never waits for push.
  void pushForMessage(channel, { kind, text, attachments, sender, updates });
  return { message, thread, duplicate: false };
}

/**
 * Push notification for a new message (services/pushService.js). Everyone who
 * can read the channel, except the sender — admins included, for every team's
 * space: the owner asked to hear about all of it, and it matches what their bell
 * already counts and chimes for in the page. Never throws.
 */
async function pushForMessage(channel, { kind, text, attachments = [], sender, updates = false }) {
  try {
    if (!pushConfigured()) return;
    const senderId = idOf(sender);
    const people = await userRepository.findChatUsers();
    const recipients = people.filter((u) => idOf(u) !== senderId && canAccess(u, channel));
    if (!recipients.length) return;
    const where = channel.kind === 'dm' ? '' : (channel.team ? STAFF_TEAM_LABELS[channel.team] || channel.team : `#${channel.name || 'chat'}`);
    const body = (text || (attachments.length ? '📎 Shared a file' : '')).replace(/\s+/g, ' ').slice(0, 200);
    await sendToUsers(
      // An order update opens that space's Order updates tab; a message opens Chat.
      recipients.map((u) => ({
        userId: idOf(u),
        url: `${isAdmin(u) ? '/admin/chat' : '/team/chat'}?c=${idOf(channel)}${updates ? '&t=updates' : ''}`,
      })),
      {
        title: kind === 'system' ? `Roavion update${where ? ` · ${where}` : ''}` : `${sender?.name || 'Message'}${where ? ` · ${where}` : ''}`,
        body,
        // Separate tags, so an order update never replaces a chat pop-up (or vice versa).
        tag: `chat-${idOf(channel)}${updates ? '-updates' : ''}`,
      },
    );
  } catch (err) {
    console.error('[Chat] push failed (ignored):', err.message);
  }
}

/**
 * Post an automatic message from the system into a default space (e.g. 'team:operations').
 * Used by business events (new paid order, refund request…). Never throws: a chat
 * hiccup must not fail the business operation that triggered it.
 */
export async function postSystemMessage(spaceKey, text, { key, orderIds, mentions, threadOrder } = {}) {
  try {
    await ensureDefaultSpaces();
    const channel = await chatRepository.findChannelByKey(spaceKey);
    const body = cleanText(text).slice(0, MESSAGE_MAX_LENGTH);
    if (!channel || !body) return null;

    // `key` makes the post idempotent: the queue retries a job, this posts once.
    // System messages have sender null, so (channel, null, key) is the unique tuple.
    if (key) {
      const existing = await chatRepository.findByClientId(channel._id, null, key);
      if (existing) return shapeMessage(existing);
    }
    const refs = await resolveOrderRefs(orderIds);
    // Same visibility filter as a person's mention. No email: the event that
    // triggered this post has already emailed the people it addresses.
    const [people] = await resolveMentions(channel, mentions, []);
    const base = { kind: 'system', sender: null, text: body, clientId: key, refs, mentions: people };

    // One thread per order per space: the first update starts it, the rest reply.
    const orderId = threadOrder && mongoose.isValidObjectId(threadOrder) ? new mongoose.Types.ObjectId(String(threadOrder)) : null;
    if (orderId) {
      const root = await chatRepository.findOrderThreadRoot(channel._id, orderId);
      if (root) return (await insertMessage(channel, { ...base, threadRoot: root })).message;
      try {
        return (await insertMessage(channel, { ...base, threadOrder: orderId })).message;
      } catch (err) {
        // Two first updates raced to start the thread; the loser replies to the winner.
        // (A duplicate on the idempotency key is handled inside insertMessage.)
        if (err?.code !== 11000) throw err;
        const winner = await chatRepository.findOrderThreadRoot(channel._id, orderId);
        if (!winner) throw err;
        return (await insertMessage(channel, { ...base, threadRoot: winner })).message;
      }
    }
    return (await insertMessage(channel, base)).message;
  } catch (err) {
    console.error(`[chat] system message to ${spaceKey} failed:`, err.message);
    return null;
  }
}

const READ_PARTS = ['chat', 'updates', 'all'];

/**
 * Mark one tab read up to `seq` — 'chat', 'updates', or 'all' (both; what a
 * page loaded before the split still sends).
 */
export async function markChannelRead(user, channelId, seq, part = 'all') {
  const channel = await loadAccessible(user, channelId);
  const which = READ_PARTS.includes(part) ? part : 'all';
  const upTo = Math.min(Math.max(Number(seq) || 0, 0), channel.lastMessageSeq);
  await markRead(user._id, channel._id, upTo, which);
  return { lastReadSeq: upTo, part: which };
}

// ── editing and deleting your own message ────────────────────────────────────
/*
  The author may edit or delete their own message for CHAT_EDIT_WINDOW_MS after
  sending it. Nobody may change anyone else's — not a head, not an admin: one
  person erasing another's words is not what this is for.

  Chat stays part of the company record (the reason deleting was switched off
  in the first place): both actions are SOFT. The row and its earlier text stay,
  and an admin reading the conversation sees them. What changes is what
  everyone else sees — "edited", or "This message was deleted".

  A snapshot of the old words also lives in two other places, and both are
  handled here, or the delete would only be cosmetic:
    - the `quote` of every reply that quoted it (flagged / refreshed);
    - the thread root's "last reply" summary, when this was the newest reply.
*/

const windowStart = (now = Date.now()) => new Date(now - CHAT_EDIT_WINDOW_MS);
const previewOf = (m) => (m.text || ((m.attachments || []).length ? 'Shared a file' : '')).slice(0, 200);
const EDIT_WINDOW_MINUTES = Math.round(CHAT_EDIT_WINDOW_MS / 60000);

/**
 * Load a message the user is about to change, and say plainly why not when
 * they may not. Order matters: "not a channel you can see" (404) before "not
 * yours" before "too late", so nobody learns anything about a message they
 * could not read, and a non-author is not told how old someone else's is.
 */
async function loadOwnMessage(user, messageId) {
  if (!mongoose.isValidObjectId(messageId)) throw fail('Message not found', 404);
  const m = await chatRepository.findMessageWithSender(messageId);
  if (!m) throw fail('Message not found', 404);
  const channel = await loadAccessible(user, m.channel);
  if (m.kind !== 'user' || idOf(m.sender) !== idOf(user._id)) {
    throw fail('You can only change your own messages', 403);
  }
  return { m, channel };
}

function assertWithinWindow(m) {
  if (new Date(m.createdAt).getTime() < windowStart().getTime()) {
    throw fail(`Messages can only be edited or deleted within ${EDIT_WINDOW_MINUTES} minutes of sending`, 403);
  }
}

/**
 * If `m` is its thread's newest reply, rewrite the thread's summary from the
 * newest reply everyone can still see. Returns the root shaped for broadcast
 * (no viewer), or null when the thread did not change.
 */
async function refreshThreadSummaryFor(m) {
  if (!m.threadRoot) return null;
  const root = await chatRepository.findMessageById(m.threadRoot);
  if (!root || root.activitySeq !== m.seq) return null; // a newer reply leads the summary
  const latest = await chatRepository.findLatestLiveReply(root._id);
  const updated = await chatRepository.setThreadSummary(root._id, latest
    ? {
      preview: previewOf(latest),
      by: latest.kind === 'system' ? 'Roavion updates' : latest.sender?.name || '',
      mentions: latest.mentions || [],
    }
    : { preview: '', by: '', mentions: [] });
  return updated ? shapeMessage(updated) : null;
}

/**
 * Edit your own message's text. Attachments, mentions and references stay as
 * they were — and nobody is emailed again: a mention notification is about the
 * moment you were addressed, and re-sending it on every typo fix would teach
 * people to ignore them.
 */
export async function editMessage(user, messageId, { text } = {}) {
  const { m, channel } = await loadOwnMessage(user, messageId);
  if (m.deletedAt) throw fail('This message was deleted', 409);
  assertWithinWindow(m);

  const body = cleanText(text).slice(0, MESSAGE_MAX_LENGTH);
  if (!body && !(m.attachments || []).length) {
    throw fail('A message needs some text — delete it instead', 400);
  }
  if (body === m.text) return { message: shapeMessage(m, null, user), thread: null };

  const updated = await chatRepository.editOwnMessage(m._id, user._id, {
    fromText: m.text, toText: body, notBefore: windowStart(),
  });
  if (!updated) {
    // Lost a race: the window closed between the check and the write, or a
    // second edit landed first. Re-read to give the real reason.
    const now = await chatRepository.findMessageById(m._id);
    if (now?.deletedAt) throw fail('This message was deleted', 409);
    assertWithinWindow(now);
    throw fail('This message was changed at the same time — please try again', 409);
  }

  await chatRepository.refreshQuotePreviews(channel._id, updated._id, previewOf(updated));
  const thread = await refreshThreadSummaryFor(updated);
  await publishChatEvent({
    type: 'message_edited',
    channelId: idOf(channel),
    route: audienceOf(channel),
    message: shapeMessage(updated), // broadcast: no viewer, never the history
    ...(thread ? { thread } : {}),
  });
  return { message: shapeMessage(updated, null, user), thread };
}

/**
 * Delete your own message. Deleting one that is already deleted is a success,
 * not an error: the person wanted it gone, and it is — a double click or a
 * retried request should not show them a failure.
 */
export async function deleteMessage(user, messageId) {
  const { m, channel } = await loadOwnMessage(user, messageId);
  if (m.deletedAt) return { deleted: true, messageId: idOf(m), thread: null };
  assertWithinWindow(m);

  const updated = await chatRepository.deleteOwnMessage(m._id, user._id, { notBefore: windowStart() });
  if (!updated) {
    const now = await chatRepository.findMessageById(m._id);
    if (now?.deletedAt) return { deleted: true, messageId: idOf(m), thread: null };
    assertWithinWindow(now);
    throw fail('Could not delete the message — please try again', 409);
  }

  await chatRepository.markQuotesDeleted(channel._id, updated._id);
  const thread = await refreshThreadSummaryFor(updated);
  // Only the id goes out. The words stay in the database for admins, and the
  // live stream reaches everyone in the channel.
  await publishChatEvent({
    type: 'message_deleted',
    channelId: idOf(channel),
    route: audienceOf(channel),
    messageId: idOf(updated),
    ...(thread ? { thread } : {}),
  });
  return { deleted: true, messageId: idOf(updated), thread };
}

/** The admin, or the person who created the group, manages a custom group's members. */
/** Who runs a custom group (adds and removes people): the admin, and any team head who is in it. */
export const mayManageMembers = (user, channel) => isAdmin(user)
  || (isChatUser(user) && user.staff?.isHead === true && (channel.members || []).some((m) => idOf(m) === idOf(user)));

async function loadManageable(user, channelId) {
  const channel = await loadAccessible(user, channelId);
  if (channel.kind !== 'space' || channel.audience !== 'members') {
    throw fail('Members are set automatically for this space (by team) — only custom groups have a member list', 400);
  }
  if (!mayManageMembers(user, channel)) throw fail('Only the admin or a team head in this group can change its members', 403);
  return channel;
}

const memberList = async (channel) => (await userRepository.findDisplayByIds((channel.members || []).map(idOf))).map(personOf);

/** The members of a custom group, for its member panel. Anyone in the group may look. */
export async function listSpaceMembers(user, channelId) {
  const channel = await loadAccessible(user, channelId);
  if (channel.kind !== 'space' || channel.audience !== 'members') throw fail('This space has no member list', 400);
  return {
    members: await memberList(channel),
    canManage: mayManageMembers(user, channel),
    canDelete: isAdmin(user),
    createdBy: idOf(channel.createdBy) || null,
  };
}

/**
 * Delete a custom group — the admin only. It disappears for everyone; its messages
 * and files are kept (archived), not destroyed, so nothing said in it is lost.
 */
export async function deleteSpace(user, channelId) {
  if (!isAdmin(user)) throw fail('Only the admin can delete a group', 403);
  const channel = await loadManageable(user, channelId);
  const before = audienceOf(channel);
  const archived = await chatRepository.archiveGroup(channel._id, user._id);
  if (!archived) throw fail('Channel not found', 404);
  // Everyone who had it in their list drops it (route computed before archiving).
  await publishChatEvent({ type: 'channel', channelId: idOf(archived), route: before });
  return { deleted: true };
}

/** Add people to a custom group. Only active staff and admins can be added. */
export async function addSpaceMembers(user, channelId, userIds) {
  const channel = await loadManageable(user, channelId);
  const requested = [...new Set((Array.isArray(userIds) ? userIds : []).map(String).filter((id) => mongoose.isValidObjectId(id)))];
  if (!requested.length) throw fail('Choose who to add', 400);
  const valid = await userRepository.findChatUsersByIds(requested);
  if (!valid.length) throw fail('Those people cannot use team chat', 400);
  const updated = await chatRepository.addMembers(channel._id, valid.map((u) => u._id));
  if (!updated) throw fail('Channel not found', 404);
  // The new members' channel lists refresh; the stream reaches them by membership.
  await publishChatEvent({ type: 'channel', channelId: idOf(updated), route: audienceOf(updated) });
  return { members: await memberList(updated), added: valid.length };
}

/** Remove someone from a custom group. The group's creator stays (it would be left with no manager). */
export async function removeSpaceMember(user, channelId, memberId) {
  const channel = await loadManageable(user, channelId);
  if (!mongoose.isValidObjectId(memberId)) throw fail('Person not found', 404);
  if (channel.createdBy && idOf(channel.createdBy) === String(memberId)) throw fail('The person who created the group cannot be removed', 400);
  const before = audienceOf(channel);
  const updated = await chatRepository.removeMember(channel._id, memberId);
  if (!updated) throw fail('Channel not found', 404);
  // Tell the removed person's list too (route computed before the removal).
  await publishChatEvent({ type: 'channel', channelId: idOf(updated), route: before });
  return { members: await memberList(updated) };
}

/** New custom space. Admins and team heads only; the creator is always a member. */
export async function createSpace(user, { name, description, memberIds } = {}) {
  if (!canCreateSpace(user)) throw fail('Only admins and team heads can create spaces', 403);
  const cleanName = cleanText(name).toLowerCase().replace(/^#/, '').replace(/\s+/g, '-').slice(0, 60);
  if (cleanName.length < 2) throw fail('Space name must be at least 2 characters', 400);

  const reserved = new Set([...DEFAULT_SPACES.map((s) => s.name), ...STAFF_TEAM_VALUES.map((t) => STAFF_TEAM_LABELS[t].toLowerCase()), 'company']);
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

// ── reactions ────────────────────────────────────────────────────────────────
/*
  Anyone who can read a message can react to it — a person's message or an
  automatic order update (a ✅ on "Order paid" is how people say "on it").
  Not a deleted one: there is nothing left to react to.

  The request says what the reaction should BE (`on: true|false`), not "toggle":
  a retried or double-sent tap then lands in the same state instead of
  undoing itself. Reactions never send a pop-up or an email — they are the
  quiet way to answer.
*/

export const MAX_REACTIONS_PER_MESSAGE = 20;

const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
// Every code point must belong to an emoji, and at least one must be a real
// picture (not just a digit, '#', or a lone skin-tone modifier).
const EMOJI_CHARS = /^[\p{Extended_Pictographic}\p{Emoji_Component}]+$/u;
const EMOJI_PICTURE = /\p{Extended_Pictographic}|\p{Regional_Indicator}{2}|\u20E3/u;

/** The emoji, if `raw` is exactly one emoji (one character as people see it); otherwise null. */
export function normalizeEmoji(raw) {
  if (typeof raw !== 'string') return null;
  const e = raw.trim();
  if (!e || e.length > 32 || !EMOJI_CHARS.test(e) || !EMOJI_PICTURE.test(e)) return null;
  let count = 0;
  for (const _ of segmenter.segment(e)) if (++count > 1) return null;
  return e;
}

/** Add (`on`, the default) or remove the caller's reaction on a message. */
export async function reactToMessage(user, messageId, { emoji, on = true } = {}) {
  if (!mongoose.isValidObjectId(messageId)) throw fail('Message not found', 404);
  const e = normalizeEmoji(emoji);
  if (!e) throw fail('Pick an emoji', 400);
  const m = await chatRepository.findMessageById(messageId);
  if (!m) throw fail('Message not found', 404);
  // 404 before anything else: nobody learns a message exists in a channel they cannot read.
  const channel = await loadAccessible(user, m.channel);
  if (m.deletedAt) throw fail('This message was deleted', 409);

  const updated = await chatRepository.setReaction(m._id, user._id, e, on !== false, MAX_REACTIONS_PER_MESSAGE);
  if (!updated) throw fail('This message was deleted', 409); // deleted between the read and the write

  const reactions = shapeReactions(updated.reactions);
  if (on !== false && !reactions.some((r) => r.emoji === e)) {
    throw fail(`A message can have up to ${MAX_REACTIONS_PER_MESSAGE} different reactions`, 400);
  }
  // Only tell the room when something changed — a retried tap is silent.
  if (JSON.stringify(reactions) !== JSON.stringify(shapeReactions(m.reactions))) {
    await publishChatEvent({
      type: 'message_reactions',
      channelId: idOf(channel),
      route: audienceOf(channel),
      messageId: idOf(m),
      threadRoot: m.threadRoot ? idOf(m.threadRoot) : null,
      reactions,
    });
  }
  return { messageId: idOf(m), reactions };
}
