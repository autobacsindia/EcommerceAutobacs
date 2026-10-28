'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CornerUpRight, Download, Phone, EyeOff, Forward, History, MessageSquareReply, MoreVertical, Package, Pencil, Pin, PinOff, Quote, RotateCcw, SmilePlus, Star, StarOff, Trash2 } from 'lucide-react';
import type { ChatAttachment, ChatMessage, ChatPerson } from '@/hooks/queries/useTeamChat';
import { meetLinkIn } from './meet';
import { Avatar, FileKindIcon, TeamBadge, dayLabel, fileSize, timeOf, useOpenUpwardIfCut } from './chatUi';
import EmojiPicker from './EmojiPicker';
import { formatMessage } from './chatFormat';

/**
 * Message text with its formatting (*bold*, _italic_, lists, code…), links and
 * @mentions drawn — as React elements, never as HTML (see chatFormat.tsx).
 */
function MessageText({ text, mentionNames, meName }: { text: string; mentionNames: string[]; meName: string }) {
  return (
    <div className="break-words text-[15px] leading-relaxed text-gray-800">
      {formatMessage(text, { mentionNames, meName })}
    </div>
  );
}

/**
 * The card under a message's first link: site, title, a line of description.
 * Text only — no image is ever loaded from the linked site.
 */
function LinkCard({ preview }: { preview: NonNullable<ChatMessage['preview']> }) {
  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-1.5 block max-w-md rounded-lg border-l-4 border-emerald-600 bg-gray-50 px-3 py-2 hover:bg-emerald-50"
    >
      <span className="block truncate text-xs text-gray-500">{preview.site}</span>
      <span className="block text-sm font-semibold text-gray-900 line-clamp-2">{preview.title}</span>
      {preview.description && <span className="mt-0.5 block text-xs text-gray-600 line-clamp-2">{preview.description}</span>}
    </a>
  );
}

/** A Google Meet link in a message: a big "Join call" button rather than a bare URL. */
function MeetCard({ url }: { url: string }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      className="mt-1.5 inline-flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 hover:bg-emerald-100">
      <span className="grid h-9 w-9 place-items-center rounded-full bg-emerald-700 text-white"><Phone className="h-4 w-4" /></span>
      <span>
        <span className="block text-sm font-semibold text-emerald-900">Google Meet call</span>
        <span className="block text-xs text-emerald-800">Tap to join</span>
      </span>
    </a>
  );
}

/** Shared photos: a tap opens the full image in a new tab. */
function Photos({ items }: { items: ChatAttachment[] }) {
  if (!items.length) return null;
  return (
    <div className={`mt-2 grid gap-2 ${items.length > 1 ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-1'}`}>
      {items.map((a) => (
        <a
          key={a.url}
          href={a.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block overflow-hidden rounded-lg border border-gray-200 bg-gray-50"
          title={`${a.name} · ${fileSize(a.size)}`}
        >
          {/* A plain <img>: these are user uploads on a private staff page, so there is
              nothing for next/image to optimise and no size known ahead of time. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={a.url}
            alt={a.name}
            loading="lazy"
            className={`w-full object-cover ${items.length > 1 ? 'h-32' : 'max-h-80 w-auto'}`}
          />
        </a>
      ))}
    </div>
  );
}

/** Documents: a row per file with its size and a download button. */
function Documents({ items }: { items: ChatAttachment[] }) {
  if (!items.length) return null;
  return (
    <div className="mt-2 space-y-1.5">
      {items.map((a) => (
        <a
          key={a.url}
          href={a.url}
          target="_blank"
          rel="noopener noreferrer"
          download={a.name}
          className="flex max-w-sm items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 p-2.5 hover:border-emerald-600 hover:bg-emerald-50"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-white text-gray-600">
            <FileKindIcon mime={a.mime} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-gray-900">{a.name}</span>
            <span className="block text-xs text-gray-500">{fileSize(a.size)}</span>
          </span>
          <Download className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
        </a>
      ))}
    </div>
  );
}

/** Order chips — straight from a message to the order itself. */
function OrderRefs({ refs, orderHref }: { refs: ChatMessage['refs']; orderHref: (id: string) => string }) {
  if (!refs.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {refs.map((r) => (
        <Link
          key={r.id}
          href={orderHref(r.id)}
          className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-900 hover:bg-emerald-100"
        >
          <Package className="h-3.5 w-3.5" aria-hidden="true" />
          Order {r.code}
        </Link>
      ))}
    </div>
  );
}

/**
 * Under a message that has a thread: how many replies, and the newest one.
 * Highlighted when that newest reply mentions me — a mention inside a thread
 * must not be invisible from the timeline.
 */
function ThreadSummary({ m, meId, onOpen }: { m: ChatMessage; meId: string; onOpen: () => void }) {
  if (!m.replyCount || !m.lastReply) return null;
  const forMe = m.lastReply.mentions.includes(meId);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`mt-1.5 flex w-full max-w-xl items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs ${
        forMe ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-gray-50 hover:border-emerald-600 hover:bg-emerald-50'
      }`}
      aria-label={`Open thread, ${m.replyCount} ${m.replyCount === 1 ? 'reply' : 'replies'}`}
    >
      <MessageSquareReply className="h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
      <span className="shrink-0 font-semibold text-emerald-800">
        {m.replyCount} {m.replyCount === 1 ? 'reply' : 'replies'}
      </span>
      <span className="min-w-0 flex-1 truncate text-gray-600">
        <span className="font-medium text-gray-800">{m.lastReply.by}:</span> {m.lastReply.preview}
      </span>
      <span className="shrink-0 text-gray-400">{timeOf(m.lastReply.at)}</span>
    </button>
  );
}

/** "Sana, Anu and you" — who put this emoji on. */
export function reactorNames(userIds: string[], meId: string, peopleById: Map<string, ChatPerson>): string {
  const others = userIds.filter((id) => id !== meId).map((id) => peopleById.get(id)?.name ?? 'Former member');
  const names = userIds.includes(meId) ? [...others, 'you'] : others;
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * The emoji under a message. Tapping one you have put on takes it off; tapping
 * someone else's adds yours. Hovering (or a long look on a phone) says who.
 */
function Reactions({
  m,
  meId,
  peopleById,
  onReact,
  onAdd,
}: {
  m: ChatMessage;
  meId: string;
  peopleById: Map<string, ChatPerson>;
  onReact?: (emoji: string, on: boolean) => void;
  onAdd?: () => void;
}) {
  const list = m.reactions ?? [];
  if (!list.length) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      {list.map((r) => {
        const mine = r.userIds.includes(meId);
        const who = reactorNames(r.userIds, meId, peopleById);
        return (
          <button
            key={r.emoji}
            type="button"
            disabled={!onReact}
            onClick={() => onReact?.(r.emoji, !mine)}
            aria-pressed={mine}
            aria-label={`${r.emoji} ${r.count} — ${who}. ${mine ? 'Remove your reaction' : 'Add yours'}`}
            title={`${who} reacted with ${r.emoji}`}
            className={`inline-flex h-7 items-center gap-1 rounded-full border px-2 text-sm leading-none transition-colors ${
              mine
                ? 'border-emerald-600 bg-emerald-50 text-emerald-900'
                : 'border-gray-200 bg-white text-gray-700 hover:border-gray-400'
            } disabled:cursor-default`}
          >
            <span className="text-base">{r.emoji}</span>
            <span className="text-xs font-semibold tabular-nums">{r.count}</span>
          </button>
        );
      })}
      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          aria-label="Add a reaction"
          title="Add a reaction"
          className="grid h-7 w-7 place-items-center rounded-full border border-gray-200 bg-white text-gray-500 hover:border-gray-400 hover:text-gray-800"
        >
          <SmilePlus className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

/** One entry in a message's "More" menu. */
export interface MoreAction {
  label: string;
  icon: React.ReactNode;
  onSelect: () => void;
}

/**
 * The less frequent actions on a message (mark unread, star…), behind ⋮ so the
 * hover bar stays small. Closes on a pick, Escape, or a click elsewhere.
 */
function MoreMenu({ actions, onClose }: { actions: MoreAction[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useOpenUpwardIfCut(ref);
  useEffect(() => {
    const onDown = (e: MouseEvent | TouchEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector('button')?.focus();
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  return (
    <div ref={ref} role="menu" aria-label="More actions"
      className="absolute right-3 top-6 z-30 w-52 rounded-xl border border-gray-200 bg-white p-1 shadow-xl">
      {actions.map((a) => (
        <button key={a.label} type="button" role="menuitem"
          onClick={() => { a.onSelect(); onClose(); }}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-gray-800 hover:bg-gray-100 focus:bg-gray-100 focus:outline-none">
          <span className="text-gray-500">{a.icon}</span>{a.label}
        </button>
      ))}
    </div>
  );
}

/** A phone or tablet: no hover, so a message's action bar opens on a tap instead. */
const isTouchScreen = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;

/** What a tap on a message must not hijack: its own links, buttons and fields. */
const INTERACTIVE = 'a,button,input,textarea,select,label,[role="menu"],[role="dialog"],[role="alertdialog"]';

/** The action-bar buttons: a bigger target on a touch screen. */
const ACTION_BTN = 'rounded-full p-1.5 text-gray-600 pointer-coarse:p-2.5';

/** The DOM id of a message row, so a quote can scroll to what it quotes. */
export const messageDomId = (id: string) => `chat-msg-${id}`;

/** The quoted message, above the reply. Clicking it jumps to the original. */
function QuoteBlock({ quote, onJump }: { quote: NonNullable<ChatMessage['quote']>; onJump?: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onJump?.(quote.id)}
      className="mb-1 block w-full max-w-xl rounded-lg border-l-4 border-emerald-600 bg-gray-50 px-3 py-1.5 text-left hover:bg-emerald-50"
      aria-label={`Quoted message from ${quote.by || 'someone'} — go to it`}
    >
      <span className="block text-xs font-semibold text-emerald-800">{quote.by || 'Former member'}</span>
      <span className={`line-clamp-2 block text-sm ${quote.deleted && !quote.preview ? 'italic text-gray-400' : 'text-gray-600'}`}>
        {/* An empty preview of a deleted message is NOT "Shared a file": the
            server withholds deleted words from everyone but admins. */}
        {quote.preview || (quote.deleted ? 'This message was deleted' : 'Shared a file')}
      </span>
    </button>
  );
}

/** When a timeline row last changed: its newest reply, or when it was posted. */
const activityAt = (m: ChatMessage) => m.lastReply?.at ?? m.createdAt;

/**
 * Is it still inside its edit window? Re-renders once, at the moment the window
 * closes, so the Edit and Delete buttons disappear on their own instead of
 * staying up to fail with "too late" when clicked. One timer per recent message
 * of yours — not a clock ticking for every row on screen.
 */
function useStillEditable(until: string | null | undefined): boolean {
  const end = until ? new Date(until).getTime() : 0;
  const [open, setOpen] = useState(() => end > Date.now());
  useEffect(() => {
    const left = end - Date.now();
    setOpen(left > 0);
    if (left <= 0) return undefined;
    // setTimeout tops out at ~24.8 days; the window is 30 minutes, so no clamp.
    const t = setTimeout(() => setOpen(false), left);
    return () => clearTimeout(t);
  }, [end]);
  return open;
}

/** The text before each edit. Admins only — the API sends it to nobody else. */
function EditHistory({ history }: { history: NonNullable<ChatMessage['editHistory']> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-800"
        aria-expanded={open}
      >
        <History className="h-3 w-3" /> {open ? 'Hide' : 'Show'} earlier version{history.length === 1 ? '' : 's'} ({history.length})
      </button>
      {open && (
        <ol className="mt-1 space-y-1 border-l-2 border-gray-200 pl-3">
          {history.map((h, i) => (
            <li key={`${h.editedAt}-${i}`} className="text-xs text-gray-500">
              <span className="whitespace-pre-wrap break-words">{h.text || '(no text)'}</span>
              <span className="ml-2 text-gray-400">replaced {timeOf(h.editedAt)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * One message, Google Chat style: round avatar, name + team + time, the text
 * below, emoji reactions under it, and a small action bar on hover (react,
 * quote it, reply in a thread — and, on your own message for 30 minutes, edit
 * or delete it).
 *
 * A deleted message reads "This message was deleted" for everyone except an
 * admin, who is sent its words and sees them marked as deleted. Which version
 * arrives is the server's decision; this only draws what it was given.
 */
export default function MessageItem({
  message,
  previous,
  meId,
  meName,
  peopleById,
  orderHref,
  onRetry,
  onOpenThread,
  onQuote,
  onJumpTo,
  onEdit,
  onDelete,
  onReact,
  onMarkUnread,
  onStar,
  onForward,
  onPin,
}: {
  message: ChatMessage;
  previous?: ChatMessage;
  meId: string;
  meName: string;
  peopleById: Map<string, ChatPerson>;
  orderHref: (id: string) => string;
  onRetry: (m: ChatMessage) => void;
  /** Open (or start) this message's thread. Absent inside a thread, where replies have no threads. */
  onOpenThread?: (m: ChatMessage) => void;
  /** Quote this message in the composer. */
  onQuote?: (m: ChatMessage) => void;
  /** Scroll to a quoted message. */
  onJumpTo?: (id: string) => void;
  /** Save new text for your own message. Rejects with a message to show. */
  onEdit?: (m: ChatMessage, text: string) => Promise<unknown>;
  /** Delete your own message. Rejects with a message to show. */
  onDelete?: (m: ChatMessage) => Promise<unknown>;
  /** Put your emoji on this message (`on`) or take it off. */
  onReact?: (m: ChatMessage, emoji: string, on: boolean) => void;
  /** Mark this message, and what follows it, unread for me. */
  onMarkUnread?: (m: ChatMessage) => void;
  /** Star it for me (`on`) or take the star off. */
  onStar?: (m: ChatMessage, on: boolean) => void;
  /** Forward a copy of it to another conversation. */
  onForward?: (m: ChatMessage) => void;
  /** Pin it to the top of the conversation (`on`) or unpin it — for everyone. */
  onPin?: (m: ChatMessage, on: boolean) => void;
}) {
  const m = message;
  // The timeline is ordered by activity, so a thread that just moved sits under
  // today's divider even if it was started last week.
  const newDay =
    !previous || new Date(activityAt(previous)).toDateString() !== new Date(activityAt(m)).toDateString();
  // Consecutive messages from one person within 5 minutes hide the repeated header.
  // A message with a thread or a quote always shows its own header.
  const grouped =
    !newDay &&
    previous &&
    !m.replyCount &&
    !previous.replyCount &&
    !m.quote &&
    previous.kind === m.kind &&
    previous.sender?.id === m.sender?.id &&
    new Date(m.createdAt).getTime() - new Date(previous.createdAt).getTime() < 5 * 60_000;
  const live = !m.deleted && !m.pending && !m.failed;
  const canReply = !!onOpenThread && live;
  const canQuote = !!onQuote && live;
  const canReact = !!onReact && live;
  const [picking, setPicking] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  // Touch screens: the action bar of the ONE message you tapped (hover does this
  // with a mouse). A tap anywhere outside the message closes it.
  const [actionsOpen, setActionsOpen] = useState(false);
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!actionsOpen) return;
    const onDown = (e: MouseEvent | TouchEvent) => { if (!row.current?.contains(e.target as Node)) setActionsOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [actionsOpen]);
  const onRowTap = (e: React.MouseEvent) => {
    if (!isTouchScreen() || (e.target as Element).closest(INTERACTIVE)) return;
    // Long-press to select text ends in a click too — leave the selection alone.
    if (window.getSelection()?.toString()) return;
    setActionsOpen((open) => !open);
  };
  const more: MoreAction[] = live
    ? [
        ...(onMarkUnread ? [{ label: 'Mark as unread', icon: <EyeOff className="h-4 w-4" />, onSelect: () => onMarkUnread(m) }] : []),
        ...(onForward ? [{ label: 'Forward', icon: <Forward className="h-4 w-4" />, onSelect: () => onForward(m) }] : []),
        ...(onPin
          ? [m.pinned
            ? { label: 'Unpin', icon: <PinOff className="h-4 w-4" />, onSelect: () => onPin(m, false) }
            : { label: 'Pin to the top', icon: <Pin className="h-4 w-4" />, onSelect: () => onPin(m, true) }]
          : []),
        ...(onStar
          ? [m.starred
            ? { label: 'Remove star', icon: <StarOff className="h-4 w-4" />, onSelect: () => onStar(m, false) }
            : { label: 'Star', icon: <Star className="h-4 w-4" />, onSelect: () => onStar(m, true) }]
          : []),
      ]
    : [];

  const mine = m.sender?.id === meId;
  const editable = useStillEditable(m.editableUntil);
  // Your own message, still inside the window. The server checks all of this
  // again — the buttons are only a convenience.
  const canChange = live && mine && m.kind === 'user' && editable;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [changeError, setChangeError] = useState('');
  const editorRef = useRef<HTMLTextAreaElement>(null);
  // The window can close while you are typing; drop out of edit mode with it.
  useEffect(() => {
    if (!canChange) { setEditing(false); setConfirmDelete(false); }
  }, [canChange]);
  useEffect(() => { if (editing) editorRef.current?.focus(); }, [editing]);

  const startEdit = () => { setDraft(m.text); setChangeError(''); setConfirmDelete(false); setEditing(true); };
  const saveEdit = async () => {
    if (!onEdit || busy) return;
    if (draft.trim() === m.text.trim()) { setEditing(false); return; }
    setBusy(true);
    setChangeError('');
    try {
      await onEdit(m, draft);
      setEditing(false);
    } catch (err) {
      setChangeError(err instanceof Error ? err.message : 'Could not save the change');
    } finally {
      setBusy(false);
    }
  };
  const doDelete = async () => {
    if (!onDelete || busy) return;
    setBusy(true);
    setChangeError('');
    try {
      await onDelete(m);
      setConfirmDelete(false);
    } catch (err) {
      setChangeError(err instanceof Error ? err.message : 'Could not delete the message');
    } finally {
      setBusy(false);
    }
  };
  // "@all" addresses me too — unless I wrote it.
  const mentionsMe = m.mentions.includes(meId) || (!!m.mentionAll && m.sender?.id !== meId);
  const mentionNames = [
    ...m.mentions.map((id) => peopleById.get(id)?.name ?? '').filter(Boolean),
    ...(m.mentionAll ? ['all'] : []),
  ];
  const photos = m.attachments.filter((a) => a.kind === 'image');
  const documents = m.attachments.filter((a) => a.kind !== 'image');

  return (
    <div id={messageDomId(m.id)} className="scroll-mt-24">
      {newDay && (
        <div className="my-4 flex items-center gap-3 text-xs font-medium text-gray-500">
          <span className="h-px flex-1 bg-gray-200" />
          <span className="rounded-full border border-gray-200 bg-white px-3 py-0.5">{dayLabel(m.createdAt)}</span>
          <span className="h-px flex-1 bg-gray-200" />
        </div>
      )}
      <div
        ref={row}
        onClick={onRowTap}
        className={`group relative flex gap-3 rounded-xl px-3 transition-colors ${grouped ? 'py-0.5' : 'mt-1 pb-1 pt-2'} ${
          mentionsMe ? 'bg-amber-50 ring-1 ring-amber-200' : actionsOpen ? 'bg-gray-100/70' : 'hover:bg-gray-100/70'
        }`}
      >
        {grouped ? <span className="w-9 shrink-0" /> : <Avatar person={m.sender} system={m.kind === 'system'} />}
        <div className="min-w-0 flex-1">
          {!grouped && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="text-sm font-semibold text-gray-900">
                {m.kind === 'system' ? 'Roavion updates' : mine ? 'You' : m.sender?.name ?? 'Former member'}
              </span>
              {m.kind === 'system' ? (
                <span className="rounded-full bg-emerald-100 px-2 py-px text-[11px] font-medium text-emerald-800">Automatic</span>
              ) : (
                <TeamBadge person={m.sender} />
              )}
              <span className="text-xs text-gray-500">{timeOf(m.createdAt)}</span>
              {m.starred && <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-500" aria-label="Starred" />}
              {m.pinned && (
                <span className="inline-flex items-center gap-0.5 text-[11px] text-gray-500" title={`Pinned by ${m.pinned.by || 'someone'}`}>
                  <Pin className="h-3 w-3" aria-hidden="true" /> Pinned
                </span>
              )}
              {m.edited && !m.deleted && (
                <span className="text-xs text-gray-400" title={m.editedAt ? `Edited ${timeOf(m.editedAt)}` : 'Edited'}>
                  (edited)
                </span>
              )}
            </div>
          )}

          {m.deleted && !(m.text || m.attachments.length) ? (
            <p className="text-sm italic text-gray-400">This message was deleted</p>
          ) : m.deleted ? (
            // Admin view: the server sent the words of a deleted message. Shown
            // muted and labelled, so it is never mistaken for a live message.
            <div className="rounded-lg border border-dashed border-red-200 bg-red-50/40 px-3 py-2">
              <p className="mb-1 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-red-700">
                <Trash2 className="h-3 w-3" /> Deleted by sender{m.deletedAt ? ` · ${timeOf(m.deletedAt)}` : ''}
              </p>
              <div className="opacity-70">
                {m.text && <MessageText text={m.text} mentionNames={mentionNames} meName={meName} />}
                <Photos items={photos} />
                <Documents items={documents} />
              </div>
            </div>
          ) : editing ? (
            <div className="max-w-xl">
              <textarea
                ref={editorRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void saveEdit(); }
                }}
                maxLength={4000}
                rows={Math.min(8, Math.max(2, draft.split('\n').length))}
                aria-label="Edit message"
                className="w-full resize-y rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
              />
              <div className="mt-1 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void saveEdit()}
                  disabled={busy || (!draft.trim() && !m.attachments.length)}
                  className="rounded-md bg-emerald-700 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? 'Saving…' : 'Save'}
                </button>
                <button type="button" onClick={() => setEditing(false)} className="rounded-md px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100">
                  Cancel
                </button>
                <span className="text-[11px] text-gray-400">Esc to cancel · Ctrl+Enter to save</span>
              </div>
            </div>
          ) : (
            <div className={m.pending ? 'opacity-60' : ''}>
              {m.quote && <QuoteBlock quote={m.quote} onJump={onJumpTo} />}
              {m.forwarded && (
                <p className="mb-0.5 inline-flex items-center gap-1 text-xs text-gray-500">
                  <CornerUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                  Forwarded · originally from <span className="font-medium text-gray-700">{m.forwarded.by || 'someone'}</span>
                  <span className="text-gray-400">· {dayLabel(m.forwarded.at)}</span>
                </p>
              )}
              {m.text && <MessageText text={m.text} mentionNames={mentionNames} meName={meName} />}
              {meetLinkIn(m.text) ? <MeetCard url={meetLinkIn(m.text)!} /> : m.preview && <LinkCard preview={m.preview} />}
              <Photos items={photos} />
              <Documents items={documents} />
              <OrderRefs refs={m.refs} orderHref={orderHref} />
              {m.pending && <p className="mt-1 text-xs text-gray-400">Sending…</p>}
            </div>
          )}
          {m.editHistory && m.editHistory.length > 0 && <EditHistory history={m.editHistory} />}
          {confirmDelete && (
            <div role="alertdialog" aria-label="Delete this message?" className="mt-1 flex flex-wrap items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">
              Delete this message for everyone?
              <button
                type="button"
                onClick={() => void doDelete()}
                disabled={busy}
                className="rounded-md bg-red-600 px-2.5 py-1 font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {busy ? 'Deleting…' : 'Delete'}
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)} className="rounded-md px-2.5 py-1 font-medium hover:bg-red-100">
                Cancel
              </button>
            </div>
          )}
          {changeError && <p role="alert" className="mt-1 text-xs text-red-600">{changeError}</p>}
          {!(m.deleted && !(m.text || m.attachments.length)) && (
            <Reactions
              m={m}
              meId={meId}
              peopleById={peopleById}
              onReact={canReact ? (emoji, on) => onReact!(m, emoji, on) : undefined}
              onAdd={canReact ? () => setPicking(true) : undefined}
            />
          )}
          {onOpenThread && <ThreadSummary m={m} meId={meId} onOpen={() => onOpenThread(m)} />}

          {m.failed && (
            <p className="mt-1 flex items-center gap-2 text-xs text-red-600">
              Not sent.
              <button type="button" className="inline-flex items-center gap-1 font-semibold underline" onClick={() => onRetry(m)}>
                <RotateCcw className="h-3 w-3" /> Retry
              </button>
            </p>
          )}
        </div>

        {picking && canReact && (
          <EmojiPicker
            className="absolute right-3 top-6"
            onPick={(emoji) => {
              const mine = (m.reactions ?? []).some((r) => r.emoji === emoji && r.userIds.includes(meId));
              // Picking one you already put on leaves it on — the picker only ever adds.
              if (!mine) onReact!(m, emoji, true);
            }}
            onClose={() => setPicking(false)}
          />
        )}
        {moreOpen && more.length > 0 && <MoreMenu actions={more} onClose={() => setMoreOpen(false)} />}
        {(canQuote || canReply || canReact || more.length > 0 || (canChange && !editing && (onEdit || onDelete))) && (
          <div
            data-testid="message-actions"
            // A pick closes the bar on a touch screen; what it opened (picker, menu) stays.
            onClick={() => setActionsOpen(false)}
            className={`absolute -top-3 right-3 z-10 items-center gap-0.5 rounded-full border border-gray-200 bg-white p-0.5 shadow-md focus-within:flex group-hover:flex ${
              actionsOpen ? 'flex' : 'hidden'
            }`}
          >
            {canReact && (
              <button
                type="button"
                onClick={() => setPicking(true)}
                className={`${ACTION_BTN} hover:bg-emerald-50 hover:text-emerald-800`}
                aria-label="Add reaction"
                title="Add reaction"
              >
                <SmilePlus className="h-4 w-4" />
              </button>
            )}
            {canQuote && (
              <button
                type="button"
                onClick={() => onQuote!(m)}
                className={`${ACTION_BTN} hover:bg-emerald-50 hover:text-emerald-800`}
                aria-label="Quote in reply"
                title="Quote in reply"
              >
                <Quote className="h-4 w-4" />
              </button>
            )}
            {canReply && (
              <button
                type="button"
                onClick={() => onOpenThread!(m)}
                className={`${ACTION_BTN} hover:bg-emerald-50 hover:text-emerald-800`}
                aria-label="Reply in thread"
                title="Reply in thread"
              >
                <MessageSquareReply className="h-4 w-4" />
              </button>
            )}
            {canChange && !editing && onEdit && (
              <button
                type="button"
                onClick={startEdit}
                className={`${ACTION_BTN} hover:bg-emerald-50 hover:text-emerald-800`}
                aria-label="Edit message"
                title="Edit (within 30 minutes of sending)"
              >
                <Pencil className="h-4 w-4" />
              </button>
            )}
            {canChange && !editing && onDelete && (
              <button
                type="button"
                onClick={() => { setChangeError(''); setConfirmDelete(true); }}
                className={`${ACTION_BTN} hover:bg-red-50 hover:text-red-700`}
                aria-label="Delete message"
                title="Delete (within 30 minutes of sending)"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
            {more.length > 0 && (
              <button
                type="button"
                onClick={() => setMoreOpen(true)}
                className={`${ACTION_BTN} hover:bg-emerald-50 hover:text-emerald-800`}
                aria-label="More actions"
                aria-haspopup="menu"
                title="More"
              >
                <MoreVertical className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
