/**
 * The chat list as Google Chat's Home draws it: one list, the conversation that
 * moved last at the top, each row with its newest message. Pure, so the order
 * and the counts are tested without rendering.
 *
 * One rule ties the numbers together: what the Chat button, the bell and the
 * "Unread" chip count is exactly the sum of the blue numbers in this list —
 * messages from people. Automatic order updates are shown on their row in grey
 * and never add to it.
 */
import { countedUnread, type ChatChannel } from '@/hooks/queries/useTeamChat';
import { timeOf } from './chatUi';

/** Unread messages from people, as this person's notification settings count them. */
export const peopleUnread = (c: ChatChannel) => countedUnread(c).chat;

const at = (c: ChatChannel) => (c.lastMessageAt ? new Date(c.lastMessageAt).getTime() : 0);
/** A conversation nobody has written in yet. */
export const isEmpty = (c: ChatChannel) => !c.lastMessageAt && !c.lastMessageSeq;

export interface HomeList {
  /** Conversations with messages, newest first (plus the open one, wherever it is). */
  active: ChatChannel[];
  /** Never used — folded behind "Show N chats with no messages yet". */
  empty: ChatChannel[];
}

/**
 * `unreadOnly` keeps chats with messages from people waiting, and the open
 * conversation so it does not vanish the moment it is read.
 */
export function homeList(channels: ChatChannel[], { unreadOnly = false, selectedId = null }: { unreadOnly?: boolean; selectedId?: string | null } = {}): HomeList {
  const shown = unreadOnly ? channels.filter((c) => peopleUnread(c) > 0 || c.id === selectedId) : channels;
  // Before anyone has written anywhere, folding would leave an empty list: show them all.
  const fold = !unreadOnly && shown.some((c) => !isEmpty(c));
  const active = shown
    .filter((c) => !fold || !isEmpty(c) || c.id === selectedId)
    .sort((a, b) => at(b) - at(a));
  const empty = fold
    ? shown.filter((c) => isEmpty(c) && c.id !== selectedId).sort((a, b) => a.name.localeCompare(b.name))
    : [];
  return { active, empty };
}

/**
 * Which conversation to open when none is named (the Chat button, the bell's
 * "Unread messages", a fresh visit on a wide screen): the newest one with a
 * message from a person waiting — where the number on the button sent you —
 * otherwise the newest conversation.
 */
export function firstToOpen(channels: ChatChannel[]): ChatChannel | null {
  const byNewest = [...channels].sort((a, b) => at(b) - at(a));
  return byNewest.find((c) => peopleUnread(c) > 0) ?? byNewest.find((c) => !isEmpty(c)) ?? byNewest[0] ?? null;
}

/** The sum the Chat button, the bell and the "Unread" chip show. */
export const totalPeopleUnread = (channels: ChatChannel[]) => channels.reduce((n, c) => n + peopleUnread(c), 0);

/** Time on a row: "10:42" today, "Yesterday", then "28 Oct". */
export function listWhen(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (d.toDateString() === now.toDateString()) return timeOf(iso);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/**
 * The sidebar's sections, as Google Chat's left column: what kind of chat it is.
 * There is no separate "Groups" section: a chat with a few people you picked is
 * listed under Spaces, beside the team and topic spaces, because to the people
 * using it there is no difference. On the server they stay what they are (a
 * group is a private conversation admins cannot read unless they are in it;
 * a space is open to admins), so nothing is moved or converted.
 */
export type SectionKey = 'dms' | 'spaces' | 'teams';
export const SECTIONS: { key: SectionKey; label: string; hint: string }[] = [
  { key: 'dms', label: 'Direct messages', hint: 'Chats with one person' },
  { key: 'spaces', label: 'Spaces', hint: 'The whole company, your team, topic spaces and chats with a few people' },
  { key: 'teams', label: 'Between teams', hint: 'Private chats between two whole teams' },
];

export const sectionOf = (c: ChatChannel): SectionKey =>
  c.kind === 'dm' ? (c.group ? 'spaces' : 'dms') : c.audience === 'teams' ? 'teams' : 'spaces';

/** Every chat in its section, newest first; never-used chats last, by name. */
export function sectionsOf(channels: ChatChannel[]): Record<SectionKey, ChatChannel[]> {
  const out: Record<SectionKey, ChatChannel[]> = { dms: [], spaces: [], teams: [] };
  for (const c of channels) out[sectionOf(c)].push(c);
  const order = (a: ChatChannel, b: ChatChannel) =>
    (isEmpty(a) ? 1 : 0) - (isEmpty(b) ? 1 : 0) || at(b) - at(a) || a.name.localeCompare(b.name);
  for (const k of Object.keys(out) as SectionKey[]) out[k].sort(order);
  return out;
}

/** How many rows a section shows before "Show all", as Google Chat does. */
export const SECTION_LIMIT = 7;

/**
 * The rows a section draws: the first SECTION_LIMIT, plus anything beyond them
 * that must not hide behind "Show all" — the open chat, and chats where a
 * person is waiting. `hidden` is how many "Show all" would add.
 */
export function sectionRows(list: ChatChannel[], { all = false, selectedId = null }: { all?: boolean; selectedId?: string | null } = {}) {
  if (all || list.length <= SECTION_LIMIT) return { rows: list, hidden: 0 };
  const rows = list.filter((c, i) => i < SECTION_LIMIT || c.id === selectedId || peopleUnread(c) > 0);
  return { rows, hidden: list.length - rows.length };
}
