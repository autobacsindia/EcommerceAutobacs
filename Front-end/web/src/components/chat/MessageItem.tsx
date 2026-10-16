'use client';

import Link from 'next/link';
import { Download, MessageSquareReply, Package, Quote, RotateCcw } from 'lucide-react';
import type { ChatAttachment, ChatMessage, ChatPerson } from '@/hooks/queries/useTeamChat';
import { Avatar, FileKindIcon, TeamBadge, dayLabel, fileSize, timeOf } from './chatUi';

/**
 * Message text as PLAIN TEXT, with links and @mentions picked out.
 *
 * Nothing here ever renders HTML from a message: the parts are split with a
 * regex and emitted as React children, so a pasted `<script>` is shown as the
 * characters a colleague typed and can never execute.
 */
function MessageText({ text, mentionNames, meName }: { text: string; mentionNames: string[]; meName: string }) {
  const escaped = mentionNames.filter(Boolean).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(
    `(https?:\\/\\/[^\\s<>"']+)${escaped.length ? `|(@(?:${escaped.join('|')}))` : ''}`,
    'g',
  );
  const parts = text.split(pattern).filter((p) => p !== undefined);

  return (
    <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-gray-800">
      {parts.map((part, i) => {
        if (/^https?:\/\//.test(part)) {
          return (
            <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="break-all text-link underline">
              {part}
            </a>
          );
        }
        if (part.startsWith('@') && mentionNames.includes(part.slice(1))) {
          const isMe = part.slice(1) === meName;
          return (
            <span
              key={i}
              className={`rounded px-1 font-semibold ${isMe ? 'bg-amber-200 text-amber-950' : 'bg-emerald-100 text-emerald-900'}`}
            >
              {part}
            </span>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </p>
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
      <span className="line-clamp-2 block text-sm text-gray-600">{quote.preview || 'Shared a file'}</span>
    </button>
  );
}

/** When a timeline row last changed: its newest reply, or when it was posted. */
const activityAt = (m: ChatMessage) => m.lastReply?.at ?? m.createdAt;

/**
 * One message, Google Chat style: round avatar, name + team + time, the text
 * below, and a small action bar on hover (quote it, reply in a thread). There is
 * no delete: chat is part of the company record and the API refuses deletes.
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

  const mine = m.sender?.id === meId;
  const mentionsMe = m.mentions.includes(meId);
  const mentionNames = m.mentions.map((id) => peopleById.get(id)?.name ?? '').filter(Boolean);
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
        className={`group relative flex gap-3 rounded-xl px-3 transition-colors ${grouped ? 'py-0.5' : 'mt-1 pb-1 pt-2'} ${
          mentionsMe ? 'bg-amber-50 ring-1 ring-amber-200' : 'hover:bg-gray-100/70'
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
            </div>
          )}

          {m.deleted ? (
            // Only messages hidden before the no-delete rule; nothing can be deleted now.
            <p className="text-sm italic text-gray-400">This message was removed</p>
          ) : (
            <div className={m.pending ? 'opacity-60' : ''}>
              {m.quote && <QuoteBlock quote={m.quote} onJump={onJumpTo} />}
              {m.text && <MessageText text={m.text} mentionNames={mentionNames} meName={meName} />}
              <Photos items={photos} />
              <Documents items={documents} />
              <OrderRefs refs={m.refs} orderHref={orderHref} />
              {m.pending && <p className="mt-1 text-xs text-gray-400">Sending…</p>}
            </div>
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

        {(canQuote || canReply) && (
          <div className="absolute -top-3 right-3 hidden items-center gap-0.5 rounded-full border border-gray-200 bg-white p-0.5 shadow-md focus-within:flex group-hover:flex pointer-coarse:flex">
            {canQuote && (
              <button
                type="button"
                onClick={() => onQuote!(m)}
                className="rounded-full p-1.5 text-gray-600 hover:bg-emerald-50 hover:text-emerald-800"
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
                className="rounded-full p-1.5 text-gray-600 hover:bg-emerald-50 hover:text-emerald-800"
                aria-label="Reply in thread"
                title="Reply in thread"
              >
                <MessageSquareReply className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
