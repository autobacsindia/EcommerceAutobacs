'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Package, Paperclip, Quote, Send, X } from 'lucide-react';
import type { ChatChannel, ChatMessage, ChatPerson, RecentOrder, SendVars } from '@/hooks/queries/useTeamChat';
import { useRecentOrders } from '@/hooks/queries/useTeamChat';
import { Avatar, FileKindIcon, GREEN, fileSize, newClientId } from './chatUi';

const MAX_FILES = 5;
const MAX_FILE_MB = 10;

/** Teams that can be addressed as a group. Mirrors the backend's list. */
const TEAMS = ['sales', 'procurement', 'accounts', 'marketing', 'operations'] as const;
/** How a team is written in a mention: the 'sales' team is GTM. */
const MENTION_NAME: Record<string, string> = { sales: 'gtm' };
const mentionName = (team: string) => MENTION_NAME[team] ?? team;

/**
 * Which teams can be @mentioned here — only where the whole team can read it:
 * #company and team spaces (any team, as before), a team-to-team conversation
 * (its two teams), and never a custom space or a DM. The API applies the same rule.
 */
export function mentionableTeams(channel: ChatChannel): readonly string[] {
  if (channel.kind !== 'space' || channel.audience === 'members') return [];
  if (channel.audience === 'teams') return channel.teams ?? [];
  return TEAMS;
}

type Pending = { file: File; preview: string | null };
/** One row in the @mention picker: either a person or a whole team. */
type MentionOption = { person?: ChatPerson; team?: string };

export default function Composer({
  channelName,
  people,
  teams,
  onSend,
  placeholder,
  quote,
  onClearQuote,
}: {
  channelName: string;
  people: ChatPerson[];
  /** Teams that may be @mentioned here (see mentionableTeams). */
  teams: readonly string[];
  onSend: (vars: SendVars) => void;
  /** Overrides "Message #channel" — e.g. "Reply in thread". */
  placeholder?: string;
  /** The message being quoted, shown above the box until sent or cleared. */
  quote?: ChatMessage | null;
  onClearQuote?: () => void;
}) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<Pending[]>([]);
  const [orders, setOrders] = useState<RecentOrder[]>([]);
  const [mentioned, setMentioned] = useState<ChatPerson[]>([]);
  const [mentionTeams, setMentionTeams] = useState<string[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [showOrders, setShowOrders] = useState(false);
  const [error, setError] = useState('');

  const box = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const { data: recentOrders = [], isLoading: ordersLoading } = useRecentOrders(showOrders);

  // Object URLs for image previews have to be released or the tab leaks memory.
  useEffect(() => () => files.forEach((f) => f.preview && URL.revokeObjectURL(f.preview)), [files]);

  // Picking "Quote in reply" puts the cursor straight in the box.
  useEffect(() => {
    if (quote) box.current?.focus();
  }, [quote]);

  // Grow with the text instead of scrolling inside one line.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  const addFiles = (incoming: FileList | File[] | null) => {
    if (!incoming) return;
    const list = Array.from(incoming);
    const room = MAX_FILES - files.length;
    if (room <= 0) return setError(`You can attach up to ${MAX_FILES} files at a time.`);
    const tooBig = list.find((f) => f.size > MAX_FILE_MB * 1024 * 1024);
    if (tooBig) setError(`"${tooBig.name}" is over ${MAX_FILE_MB} MB and was not added.`);
    const accepted = list.filter((f) => f.size <= MAX_FILE_MB * 1024 * 1024).slice(0, room);
    if (accepted.length) setError('');
    setFiles((prev) => [
      ...prev,
      ...accepted.map((file) => ({
        file,
        preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
      })),
    ]);
  };

  const removeFile = (index: number) =>
    setFiles((prev) => {
      const target = prev[index];
      if (target?.preview) URL.revokeObjectURL(target.preview);
      return prev.filter((_, i) => i !== index);
    });

  // "@" plus what has been typed since, so the picker filters as you type.
  const onChangeText = (value: string) => {
    setText(value);
    const upToCaret = value.slice(0, box.current?.selectionStart ?? value.length);
    const match = /(?:^|\s)@([\w ]{0,20})$/.exec(upToCaret);
    setMentionQuery(match ? match[1] : null);
  };

  const mentionOptions = useMemo<MentionOption[]>(() => {
    if (mentionQuery == null) return [];
    const q = mentionQuery.trim().toLowerCase();
    const peopleHits = people.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 6);
    const teamHits = teams.filter((t) => mentionName(t).includes(q)).slice(0, 3);
    return [...teamHits.map((t) => ({ team: t })), ...peopleHits.map((p) => ({ person: p }))];
  }, [mentionQuery, people, teams]);

  /** Swap the half-typed "@foo" for the chosen name and remember who was meant. */
  const pickMention = (option: MentionOption) => {
    const label = option.person?.name ?? (option.team ? mentionName(option.team) : '');
    setText((prev) => prev.replace(/(^|\s)@([\w ]{0,20})$/, (_m, lead) => `${lead}@${label} `));
    if (option.person) setMentioned((prev) => (prev.some((p) => p.id === option.person!.id) ? prev : [...prev, option.person!]));
    if (option.team) setMentionTeams((prev) => (prev.includes(option.team!) ? prev : [...prev, option.team!]));
    setMentionQuery(null);
    box.current?.focus();
  };

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const body = text.trim();
    if (!body && !files.length) return;
    onSend({
      text: body,
      clientId: newClientId(),
      // Only keep mentions whose name survived any later editing of the text.
      mentions: mentioned.filter((p) => body.includes(`@${p.name}`)).map((p) => p.id),
      mentionTeams: mentionTeams.filter((t) => body.includes(`@${mentionName(t)}`)),
      orderIds: orders.map((o) => o.id),
      files: files.map((f) => f.file),
      ...(quote ? { quoteId: quote.id } : {}),
    });
    onClearQuote?.();
    files.forEach((f) => f.preview && URL.revokeObjectURL(f.preview));
    setText('');
    setFiles([]);
    setOrders([]);
    setMentioned([]);
    setMentionTeams([]);
    setError('');
  };

  return (
    <form
      onSubmit={submit}
      className="px-3 pb-3 pt-1 sm:px-4"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        addFiles(e.dataTransfer.files);
      }}
    >
      {/* Chosen attachments and orders, removable before sending. */}
      {(files.length > 0 || orders.length > 0) && (
        <div className="mb-2 flex flex-wrap gap-2">
          {files.map((f, i) => (
            <span key={`${f.file.name}-${i}`} className="relative flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-1.5 pr-7">
              {f.preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={f.preview} alt="" className="h-10 w-10 rounded object-cover" />
              ) : (
                <span className="grid h-10 w-10 place-items-center rounded bg-white text-gray-500">
                  <FileKindIcon mime={f.file.type} />
                </span>
              )}
              <span className="max-w-[9rem] truncate text-xs text-gray-700">
                {f.file.name}
                <span className="block text-gray-400">{fileSize(f.file.size)}</span>
              </span>
              <button type="button" onClick={() => removeFile(i)} className="absolute right-1 top-1 rounded p-0.5 text-gray-400 hover:text-red-600" aria-label={`Remove ${f.file.name}`}>
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
          {orders.map((o) => (
            <span key={o.id} className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm text-emerald-900">
              <Package className="h-3.5 w-3.5" aria-hidden="true" /> {o.code}
              <button type="button" onClick={() => setOrders((prev) => prev.filter((x) => x.id !== o.id))} aria-label={`Remove order ${o.code}`}>
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}

      {quote && (
        <div className="mb-2 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
          <Quote className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-emerald-800">
              Quoting {quote.kind === 'system' ? 'Roavion updates' : quote.sender?.name ?? 'Former member'}
            </p>
            <p className="truncate text-sm text-gray-700">{quote.text || 'Shared a file'}</p>
          </div>
          <button type="button" onClick={onClearQuote} className="rounded-full p-1 text-gray-500 hover:bg-white" aria-label="Remove quote">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="relative">
        {/* @mention picker */}
        {mentionOptions.length > 0 && (
          <ul className="absolute bottom-full z-20 mb-2 w-72 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg" role="listbox" aria-label="Mention someone">
            {mentionOptions.map((option) => (
              <li key={option.person?.id ?? `team-${option.team}`}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pickMention(option)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-emerald-50"
                >
                  {option.person ? (
                    <>
                      <Avatar person={option.person} size="sm" />
                      <span className="min-w-0 flex-1 truncate text-sm text-gray-900">{option.person.name}</span>
                      <span className="text-xs text-gray-500">{option.person.teamLabel}</span>
                    </>
                  ) : (
                    <>
                      <span className="grid h-7 w-7 place-items-center rounded-lg bg-gray-100 text-xs font-bold text-gray-700">@</span>
                      <span className="flex-1 text-sm text-gray-900">@{mentionName(option.team ?? "")}</span>
                      <span className="text-xs text-gray-500">whole team</span>
                    </>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Order picker */}
        {showOrders && (
          <div className="absolute bottom-full z-20 mb-2 max-h-72 w-80 overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-lg">
            <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
              <span className="text-sm font-semibold text-gray-900">Link an order</span>
              <button type="button" onClick={() => setShowOrders(false)} className="rounded p-1 text-gray-400 hover:bg-gray-100" aria-label="Close order picker">
                <X className="h-4 w-4" />
              </button>
            </div>
            {ordersLoading && <p className="p-3 text-sm text-gray-500">Loading recent orders…</p>}
            {!ordersLoading && recentOrders.length === 0 && <p className="p-3 text-sm text-gray-500">No paid orders yet.</p>}
            {recentOrders.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => {
                  setOrders((prev) => (prev.some((x) => x.id === o.id) ? prev : [...prev, o]));
                  setShowOrders(false);
                }}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-emerald-50"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-gray-900">{o.code} · {o.customer}</span>
                  <span className="block text-xs text-gray-500">{o.status}</span>
                </span>
                <span className="shrink-0 text-sm font-semibold text-gray-700">
                  ₹{o.total.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="flex items-end gap-1 rounded-3xl border border-transparent bg-gray-100 p-1.5 transition-colors focus-within:border-emerald-600 focus-within:bg-white">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-gray-600 hover:bg-gray-200 hover:text-gray-800"
            aria-label="Attach a file"
            title="Attach a photo or document"
          >
            <Paperclip className="h-[18px] w-[18px]" />
          </button>
          <button
            type="button"
            onClick={() => setShowOrders((v) => !v)}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-gray-600 hover:bg-gray-200 hover:text-gray-800"
            aria-label="Link an order"
            title="Link an order"
          >
            <Package className="h-[18px] w-[18px]" />
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,text/csv,text/plain,.xlsx,.docx"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = ''; // let the same file be picked again after removing it
            }}
          />
          <textarea
            ref={box}
            value={text}
            onChange={(e) => onChangeText(e.target.value)}
            onPaste={(e) => {
              const pasted = Array.from(e.clipboardData.files);
              if (pasted.length) {
                e.preventDefault();
                addFiles(pasted);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setMentionQuery(null);
                setShowOrders(false);
                if (!mentionOptions.length && !showOrders) onClearQuote?.();
                return;
              }
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                // While the mention list is open, Enter should pick, not send.
                if (mentionOptions.length) {
                  e.preventDefault();
                  pickMention(mentionOptions[0]);
                  return;
                }
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            maxLength={4000}
            placeholder={placeholder ?? `Message ${channelName}`}
            aria-label={placeholder ?? `Message ${channelName}`}
            className="max-h-40 min-h-[40px] flex-1 resize-none border-0 bg-transparent px-2 py-2 text-[15px] text-gray-900 outline-none"
          />
          <button
            type="submit"
            disabled={!text.trim() && !files.length}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-white disabled:opacity-40"
            style={{ background: GREEN }}
            aria-label="Send message"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
      <p className="mt-1 hidden text-[11px] text-gray-400 sm:block">
        Enter to send · Shift + Enter for a new line · @ to mention · drag a file in to share it
      </p>
    </form>
  );
}
