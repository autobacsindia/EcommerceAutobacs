'use client';

import Link from 'next/link';
import { Download, Package, RotateCcw, Trash2 } from 'lucide-react';
import type { ChatAttachment, ChatMessage, ChatPerson } from '@/hooks/queries/useTeamChat';
import { Avatar, FileKindIcon, dayLabel, fileSize, timeOf } from './chatUi';

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
            <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="break-all text-[#0b6b9a] underline">
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

export default function MessageItem({
  message,
  previous,
  meId,
  meName,
  peopleById,
  canDelete,
  orderHref,
  onDelete,
  onRetry,
}: {
  message: ChatMessage;
  previous?: ChatMessage;
  meId: string;
  meName: string;
  peopleById: Map<string, ChatPerson>;
  canDelete: boolean;
  orderHref: (id: string) => string;
  onDelete: (m: ChatMessage) => void;
  onRetry: (m: ChatMessage) => void;
}) {
  const m = message;
  const newDay =
    !previous || new Date(previous.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
  // Consecutive messages from one person within 5 minutes hide the repeated header.
  const grouped =
    !newDay &&
    previous &&
    previous.kind === m.kind &&
    previous.sender?.id === m.sender?.id &&
    new Date(m.createdAt).getTime() - new Date(previous.createdAt).getTime() < 5 * 60_000;

  const mine = m.sender?.id === meId;
  const mentionsMe = m.mentions.includes(meId);
  const mentionNames = m.mentions.map((id) => peopleById.get(id)?.name ?? '').filter(Boolean);
  const photos = m.attachments.filter((a) => a.kind === 'image');
  const documents = m.attachments.filter((a) => a.kind !== 'image');
  const removable = canDelete && !m.deleted && !m.pending && !m.failed && m.kind === 'user';

  return (
    <div>
      {newDay && (
        <div className="my-3 flex items-center gap-3 text-xs font-medium text-gray-500">
          <span className="h-px flex-1 bg-gray-200" />
          {dayLabel(m.createdAt)}
          <span className="h-px flex-1 bg-gray-200" />
        </div>
      )}
      <div
        className={`group relative flex gap-3 rounded-lg px-2 ${grouped ? 'py-0.5' : 'mt-2 py-1'} ${
          mentionsMe ? 'bg-amber-50 ring-1 ring-amber-200' : 'hover:bg-gray-50'
        }`}
      >
        {grouped ? <span className="w-9 shrink-0" /> : <Avatar person={m.sender} system={m.kind === 'system'} />}
        <div className="min-w-0 flex-1">
          {!grouped && (
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-sm font-semibold text-gray-900">
                {m.kind === 'system' ? 'Roavion updates' : mine ? 'You' : m.sender?.name ?? 'Former member'}
              </span>
              {m.kind !== 'system' && m.sender?.teamLabel && (
                <span className="text-xs text-gray-500">{m.sender.teamLabel}</span>
              )}
              <span className="text-xs text-gray-400">{timeOf(m.createdAt)}</span>
            </div>
          )}

          {m.deleted ? (
            <p className="text-sm italic text-gray-400">This message was deleted</p>
          ) : (
            <div className={m.pending ? 'opacity-60' : ''}>
              {m.text && <MessageText text={m.text} mentionNames={mentionNames} meName={meName} />}
              <Photos items={photos} />
              <Documents items={documents} />
              <OrderRefs refs={m.refs} orderHref={orderHref} />
              {m.pending && <p className="mt-1 text-xs text-gray-400">Sending…</p>}
            </div>
          )}

          {m.failed && (
            <p className="mt-1 flex items-center gap-2 text-xs text-red-600">
              Not sent.
              <button type="button" className="inline-flex items-center gap-1 font-semibold underline" onClick={() => onRetry(m)}>
                <RotateCcw className="h-3 w-3" /> Retry
              </button>
            </p>
          )}
        </div>

        {removable && (
          <button
            type="button"
            onClick={() => onDelete(m)}
            className="absolute right-2 top-1 hidden rounded-md bg-white p-1 text-gray-400 shadow-sm hover:text-red-600 focus:block group-hover:block"
            aria-label="Delete message"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
