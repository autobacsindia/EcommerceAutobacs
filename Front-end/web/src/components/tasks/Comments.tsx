'use client';

import { useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { MessageSquare, Paperclip, Pencil, Send, SmilePlus, Trash2, X } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { submitMultipart, parseApiResponse } from '@/lib/multipartResponse';
import { MAX_ATTACHMENT_BYTES, mb } from '@/lib/attachments';
import { taskKeys } from '@/hooks/queries/keys';
import { formatDateTimeIST } from '@/lib/datetime';
import { errorMessage } from '@/components/staff/sales/types';
import EmojiPicker from '@/components/chat/EmojiPicker';
import { FileKindIcon, fileSize } from '@/components/chat/chatUi';
import { Avatar } from './ui';
import {
  COMMENT_FILES_MAX, TASK_FILES_MAX, TASK_FILE_ACCEPT, newClientId,
  type CommentPage, type Task, type TaskComment, type TaskFile,
} from './types';

const taskPath = (id: string) => `/staff/tasks/${encodeURIComponent(id)}`;

/** "just now", "5m ago", "3h ago", "2d ago", then the date. */
export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return formatDateTimeIST(iso);
}

/** Send a form with files (apiClient only speaks JSON); same cookies and CSRF header. */
async function sendForm<T>(path: string, form: FormData): Promise<T> {
  const res = await submitMultipart(`/api/v1${path}`, 'POST', form);
  const body = await parseApiResponse(res);
  if (!res.ok) throw new Error((body as { message?: string }).message || 'Could not upload the files.');
  return body as unknown as T;
}

/** Keep files the server would take; say why the rest were left out. */
function pickFiles(incoming: FileList | null, room: number, onError: (msg: string) => void): File[] {
  const list = Array.from(incoming ?? []);
  const tooBig = list.filter((f) => f.size > MAX_ATTACHMENT_BYTES);
  if (tooBig.length) onError(`"${tooBig[0].name}" is over ${mb(MAX_ATTACHMENT_BYTES)} and was not added.`);
  const fitting = list.filter((f) => f.size <= MAX_ATTACHMENT_BYTES);
  if (fitting.length > room) onError(room > 0 ? `Only ${room} more file${room === 1 ? '' : 's'} fit here.` : 'No more files fit here.');
  return fitting.slice(0, Math.max(room, 0));
}

function FileChip({ file, onRemove }: { file: TaskFile; onRemove?: () => void }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-gray-200 bg-white py-1 pl-1.5 pr-1 text-xs">
      {file.kind === 'image' ? (
        // eslint-disable-next-line @next/next/no-img-element -- private, cookie-authenticated bytes; next/image cannot fetch them
        <img src={file.url} alt="" className="h-8 w-8 rounded object-cover" />
      ) : (
        <FileKindIcon mime={file.mime} className="h-5 w-5 text-gray-500" />
      )}
      <a href={file.url} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate font-medium text-gray-800 hover:underline">{file.name}</a>
      <span className="shrink-0 text-gray-400">{fileSize(file.size)}</span>
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`Remove ${file.name}`} className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </span>
  );
}

// ── The task's own files ─────────────────────────────────────────────────────

/** Bills, photos and documents kept on the task (not inside a comment). */
export function TaskFiles({ task }: { task: Task }) {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const files = task.files ?? [];
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: taskKeys.one(task.id) });
  };
  const upload = useMutation({
    mutationFn: (picked: File[]) => {
      const form = new FormData();
      for (const f of picked) form.append('files', f);
      return sendForm<{ task: Task }>(`${taskPath(task.id)}/files`, form);
    },
    onSuccess: () => { setError(''); refresh(); },
    onError: (e) => setError(errorMessage(e, 'Could not upload the files.')),
  });
  const remove = useMutation({
    mutationFn: (f: TaskFile) => apiClient.delete(`${taskPath(task.id)}/files/${encodeURIComponent(f.url.split('/').pop() ?? '')}`),
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(e, 'Could not remove the file.')),
  });
  if (!files.length && !task.can.files) return null;

  return (
    <section>
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-gray-900">
        <Paperclip aria-hidden className="h-4 w-4 text-gray-500" /> Files
        {files.length > 0 && <span className="font-normal text-gray-400">{files.length}</span>}
      </h3>
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {files.map((f) => (
            <li key={f.url} className="max-w-full">
              <FileChip file={f} onRemove={f.canRemove ? () => { if (window.confirm(`Remove "${f.name}" from this task?`)) remove.mutate(f); } : undefined} />
            </li>
          ))}
        </ul>
      )}
      {task.can.files && (
        <>
          <input
            ref={input}
            type="file"
            multiple
            hidden
            accept={TASK_FILE_ACCEPT}
            aria-label="Add files to the task"
            onChange={(e) => {
              const picked = pickFiles(e.target.files, TASK_FILES_MAX - files.length, setError);
              e.target.value = '';
              if (picked.length) upload.mutate(picked);
            }}
          />
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={upload.isPending || files.length >= TASK_FILES_MAX}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-2.5 py-1.5 text-sm text-gray-600 hover:border-gray-400 hover:text-gray-800 disabled:opacity-50"
          >
            <Paperclip className="h-4 w-4" /> {upload.isPending ? 'Uploading…' : 'Add files'}
          </button>
        </>
      )}
      {error && <p role="alert" className="mt-1 text-sm text-red-600">{error}</p>}
    </section>
  );
}

// ── @mentions ────────────────────────────────────────────────────────────────

type Person = { id: string; name: string };

/** Who may be @mentioned on this task: the people who can already see it. */
function useMentionable(taskId: string, enabled: boolean) {
  return useQuery({
    queryKey: [...taskKeys.one(taskId), 'mentionable'],
    queryFn: () => apiClient.get<{ people: Person[] }>(`${taskPath(taskId)}/mentionable`),
    enabled,
    staleTime: 5 * 60_000,
  });
}

/** The "@word" being typed at the caret, or null. */
function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const m = /(^|\s)@([^\s@]{0,30})$/.exec(text.slice(0, caret));
  return m ? { start: caret - m[2].length - 1, query: m[2] } : null;
}

/** Words with "@Name" for each person mentioned, the rest as written. */
function withMentions(text: string, mentions: Person[]) {
  if (!mentions.length) return text;
  const names = [...mentions].sort((a, b) => b.name.length - a.name.length).map((p) => p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const parts = text.split(new RegExp(`(@(?:${names.join('|')}))`, 'g'));
  return parts.map((part, i) => (i % 2 === 1
    ? <span key={i} className="rounded bg-blue-50 px-0.5 font-medium text-blue-800">{part}</span>
    : part));
}

// ── One comment ──────────────────────────────────────────────────────────────

function Reactions({ c, onToggle }: { c: TaskComment; onToggle: (emoji: string, on: boolean) => void }) {
  const [picking, setPicking] = useState(false);
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      {c.reactions.map((r) => (
        <button
          key={r.emoji}
          type="button"
          onClick={() => onToggle(r.emoji, !r.mine)}
          aria-pressed={r.mine}
          title={r.names.join(', ')}
          aria-label={`${r.emoji} ${r.count}: ${r.names.join(', ')}`}
          className={`inline-flex h-6 items-center gap-1 rounded-full border px-1.5 text-xs ${r.mine ? 'border-blue-300 bg-blue-50 text-blue-800' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'}`}
        >
          <span aria-hidden>{r.emoji}</span> {r.count}
        </button>
      ))}
      <span className="relative">
        <button type="button" onClick={() => setPicking(true)} aria-label="Add a reaction" className="grid h-6 w-6 place-items-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700">
          <SmilePlus className="h-4 w-4" />
        </button>
        {picking && (
          <EmojiPicker
            className="absolute left-0 top-7"
            onClose={() => setPicking(false)}
            onPick={(e) => onToggle(e, !c.reactions.some((r) => r.emoji === e && r.mine))}
          />
        )}
      </span>
    </div>
  );
}

function CommentItem({ task, c }: { task: Task; c: TaskComment }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(c.text);
  const path = `${taskPath(task.id)}/comments/${encodeURIComponent(c.id)}`;
  const refresh = () => queryClient.invalidateQueries({ queryKey: taskKeys.comments(task.id) });
  /** Put the server's copy of this comment in place (edits, reactions). */
  const put = (next: TaskComment) => queryClient.setQueryData<{ pages: CommentPage[]; pageParams: unknown[] }>(
    taskKeys.comments(task.id),
    (d) => (d ? { ...d, pages: d.pages.map((p) => ({ ...p, comments: p.comments.map((x) => (x.id === next.id ? next : x)) })) } : d),
  );
  const edit = useMutation({
    mutationFn: () => apiClient.patch<{ comment: TaskComment }>(path, { text: draft.trim() }),
    onSuccess: (r) => { put(r.comment); setEditing(false); },
    onError: (e) => toast.error(errorMessage(e, 'Could not save the change.')),
  });
  const del = useMutation({
    mutationFn: () => apiClient.delete<{ comment: TaskComment }>(path),
    onSuccess: (r) => { put(r.comment); queryClient.invalidateQueries({ queryKey: taskKeys.one(task.id) }); },
    onError: (e) => toast.error(errorMessage(e, 'Could not delete the comment.')),
  });
  const react = useMutation({
    mutationFn: ({ emoji, on }: { emoji: string; on: boolean }) => apiClient.put<{ comment: TaskComment }>(`${path}/reactions`, { emoji, on }),
    onSuccess: (r) => put(r.comment),
    onError: (e) => { toast.error(errorMessage(e, 'Could not add the reaction.')); refresh(); },
  });
  const changeable = !!c.editableUntil && new Date(c.editableUntil).getTime() > Date.now();

  return (
    <li className="group flex gap-2.5">
      <Avatar name={c.by.name} id={c.by.id} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="rounded-lg rounded-tl-none bg-gray-50 px-3 py-2">
          <p className="flex items-center gap-1 text-xs text-gray-500">
            <span className="font-semibold text-gray-900">{c.by.name}</span> · <time title={formatDateTimeIST(c.createdAt)}>{timeAgo(c.createdAt)}</time>
            {c.editedAt && !c.deleted && <span title={formatDateTimeIST(c.editedAt)}>· edited</span>}
            {changeable && !editing && (
              <span className="ml-auto flex gap-0.5 opacity-100 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
                <button type="button" onClick={() => { setDraft(c.text); setEditing(true); }} aria-label="Edit comment" className="rounded p-1 hover:bg-gray-200"><Pencil className="h-3.5 w-3.5" /></button>
                <button type="button" onClick={() => { if (window.confirm('Delete this comment?')) del.mutate(); }} aria-label="Delete comment" className="rounded p-1 hover:bg-gray-200"><Trash2 className="h-3.5 w-3.5" /></button>
              </span>
            )}
          </p>
          {c.deleted ? (
            <p className="mt-0.5 text-sm italic text-gray-400">This comment was deleted.</p>
          ) : editing ? (
            <form onSubmit={(e) => { e.preventDefault(); if (draft.trim()) edit.mutate(); }} className="mt-1">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setEditing(false); } }}
                autoFocus
                rows={2}
                maxLength={2000}
                aria-label="Edit comment"
                className="w-full resize-y rounded-md border border-gray-200 bg-white px-2 py-1 text-sm"
              />
              <div className="mt-1 flex gap-2">
                <button type="submit" disabled={edit.isPending || !draft.trim()} className="rounded-md bg-gray-900 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40">Save</button>
                <button type="button" onClick={() => setEditing(false)} className="rounded-md px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-200">Cancel</button>
              </div>
            </form>
          ) : (
            <>
              {c.text && <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-gray-800">{withMentions(c.text, c.mentions)}</p>}
              {c.files.length > 0 && (
                <ul className="mt-1.5 flex flex-wrap gap-1.5">{c.files.map((f) => <li key={f.url} className="max-w-full"><FileChip file={f} /></li>)}</ul>
              )}
            </>
          )}
        </div>
        {!c.deleted && (task.can.comment || c.reactions.length > 0) && (
          task.can.comment
            ? <Reactions c={c} onToggle={(emoji, on) => react.mutate({ emoji, on })} />
            : <p className="mt-1 text-xs text-gray-500">{c.reactions.map((r) => `${r.emoji} ${r.count}`).join('  ')}</p>
        )}
      </div>
    </li>
  );
}

// ── Writing a comment ────────────────────────────────────────────────────────

function CommentBox({ task }: { task: Task }) {
  const queryClient = useQueryClient();
  const box = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [mentioned, setMentioned] = useState<Person[]>([]);
  const [at, setAt] = useState<{ start: number; query: string } | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [error, setError] = useState('');
  // One id per comment being written, so a double-send posts once (and pops up once).
  const clientId = useRef(newClientId());
  const people = useMentionable(task.id, at !== null);
  const options = useMemo(() => {
    if (!at) return [];
    const q = at.query.toLowerCase();
    return (people.data?.people ?? []).filter((p) => p.name.toLowerCase().includes(q)).slice(0, 6);
  }, [at, people.data]);

  const send = useMutation({
    mutationFn: () => {
      const body = text.trim();
      // Only the people whose "@Name" is still in the words.
      const mentions = mentioned.filter((p) => body.includes(`@${p.name}`)).map((p) => p.id);
      const path = `${taskPath(task.id)}/comments`;
      if (!files.length) return apiClient.post<{ comment: TaskComment }>(path, { text: body, clientId: clientId.current, mentions });
      const form = new FormData();
      form.append('text', body);
      form.append('clientId', clientId.current);
      if (mentions.length) form.append('mentions', JSON.stringify(mentions));
      for (const f of files) form.append('files', f);
      return sendForm<{ comment: TaskComment }>(path, form);
    },
    onSuccess: () => {
      setText('');
      setFiles([]);
      setMentioned([]);
      setError('');
      clientId.current = newClientId();
      queryClient.invalidateQueries({ queryKey: taskKeys.comments(task.id) });
      queryClient.invalidateQueries({ queryKey: taskKeys.one(task.id) });
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
    },
    onError: (e) => setError(errorMessage(e, 'Could not post the comment.')),
  });
  const ready = (text.trim() || files.length) && !send.isPending;

  const choose = (p: Person) => {
    if (!at) return;
    const caret = box.current?.selectionStart ?? text.length;
    const next = `${text.slice(0, at.start)}@${p.name} ${text.slice(caret)}`;
    setText(next);
    setMentioned((m) => (m.some((x) => x.id === p.id) ? m : [...m, p]));
    setAt(null);
    const pos = at.start + p.name.length + 2;
    requestAnimationFrame(() => { box.current?.focus(); box.current?.setSelectionRange(pos, pos); });
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); if (ready) send.mutate(); }} className="relative mt-4">
      {at && options.length > 0 && (
        <ul role="listbox" aria-label="People to mention" className="absolute bottom-full left-0 z-20 mb-1 w-64 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
          {options.map((p, i) => (
            <li key={p.id} role="option" aria-selected={i === highlight}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); choose(p); }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${i === highlight ? 'bg-blue-50 text-blue-800' : 'text-gray-800 hover:bg-gray-50'}`}
              >
                <Avatar name={p.name} id={p.id} size="sm" /> {p.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="rounded-xl border border-gray-200 bg-white p-2 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100">
        <textarea
          ref={box}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setAt(mentionAt(e.target.value, e.target.selectionStart));
            setHighlight(0);
          }}
          onKeyDown={(e) => {
            if (at && options.length) {
              if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => (h + 1) % options.length); return; }
              if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => (h - 1 + options.length) % options.length); return; }
              if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); choose(options[highlight]); return; }
              if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setAt(null); return; }
            }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && ready) { e.preventDefault(); send.mutate(); }
          }}
          maxLength={2000}
          rows={2}
          placeholder="Write an update or a question… type @ to mention someone"
          aria-label="Comment"
          className="w-full resize-none border-0 bg-transparent px-1 text-sm outline-none"
        />
        {files.length > 0 && (
          <ul className="mb-1 flex flex-wrap gap-1.5 px-1" aria-label="Files to send">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="max-w-full">
                <FileChip
                  file={{ url: '#', name: f.name, mime: f.type, size: f.size, kind: 'file' }}
                  onRemove={() => setFiles((all) => all.filter((_, j) => j !== i))}
                />
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center justify-between gap-2">
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            accept={TASK_FILE_ACCEPT}
            aria-label="Attach files to the comment"
            onChange={(e) => {
              const picked = pickFiles(e.target.files, COMMENT_FILES_MAX - files.length, setError);
              e.target.value = '';
              setFiles((all) => [...all, ...picked]);
            }}
          />
          <button type="button" onClick={() => fileInput.current?.click()} aria-label="Attach files" title="Attach files" className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800">
            <Paperclip className="h-4 w-4" />
          </button>
          <span className="hidden text-[11px] text-gray-400 sm:inline">Ctrl/⌘ + Enter to send</span>
          <button type="submit" aria-label="Post" disabled={!ready} className="rounded-lg bg-blue-600 p-2 text-white disabled:opacity-40">
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
      {error && <p role="alert" className="mt-1 text-sm text-red-600">{error}</p>}
    </form>
  );
}

// ── Activity: comments and history on one timeline ───────────────────────────

type HistoryEntry = NonNullable<Task['history']>[number];

export function Activity({ task, describe }: { task: Task; describe: (h: HistoryEntry) => string }) {
  const q = useInfiniteQuery({
    queryKey: taskKeys.comments(task.id),
    queryFn: ({ pageParam }) => apiClient.get<CommentPage>(
      `${taskPath(task.id)}/comments${pageParam ? `?before=${encodeURIComponent(pageParam)}` : ''}`,
    ),
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextBefore || undefined,
    refetchInterval: 30_000,
  });
  const comments: TaskComment[] = q.data?.pages.flatMap((p) => p.comments) ?? [];
  const items = [
    ...(task.history ?? []).map((h, i) => ({ kind: 'event' as const, key: `e-${i}-${h.at}`, at: h.at, h })),
    ...comments.map((c) => ({ kind: 'comment' as const, key: c.id, at: c.createdAt, c })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  return (
    <section>
      <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-gray-900">
        <MessageSquare aria-hidden className="h-4 w-4 text-gray-500" /> Activity
      </h3>
      {q.hasNextPage && (
        <button onClick={() => q.fetchNextPage()} className="mb-2 text-xs font-medium text-blue-700 hover:underline">Show older comments</button>
      )}
      <ol className="space-y-3">
        {items.map((it) => (it.kind === 'comment' ? (
          <CommentItem key={it.key} task={task} c={it.c} />
        ) : (
          <li key={it.key} className="flex items-start gap-2.5 pl-1.5 text-xs text-gray-500">
            <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gray-300" />
            <p><span className="font-medium text-gray-700">{it.h.by}</span> {describe(it.h)} · <time title={formatDateTimeIST(it.at)}>{timeAgo(it.at)}</time></p>
          </li>
        )))}
      </ol>
      {task.can.comment && <CommentBox task={task} />}
    </section>
  );
}

