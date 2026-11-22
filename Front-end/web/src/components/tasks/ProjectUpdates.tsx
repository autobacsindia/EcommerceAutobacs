'use client';

/**
 * A project's Updates: what happened on the job, in words, photos and videos,
 * newest first ("Bumper fitted — see the video"). Anyone who sees the project
 * reads and posts; the poster, the project owner or the admin deletes
 * (services/staffProjectUpdateService.js decides, `canDelete` says so).
 *
 * Posting carries a client id, so a double-tap or a retry saves one update.
 */
import { useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Megaphone, Paperclip, Send, Trash2 } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { usePasteFiles } from '@/hooks/usePasteFiles';
import RichText from '@/components/ui/RichText';
import RichTextBox from '@/components/ui/RichTextBox';
import { isRichTextEmpty } from '@/lib/richText';
import { taskKeys } from '@/hooks/queries/keys';
import { formatDateTimeIST } from '@/lib/datetime';
import { errorMessage } from '@/components/staff/sales/types';
import { Avatar } from './ui';
import { FileChip, MediaFiles, kindOf, pickFiles, sendForm } from './media';
import {
  LONG_TEXT_MAX, PROJECT_UPDATE_FILES_MAX, TASK_FILE_ACCEPT, newClientId,
  type Project, type ProjectUpdate, type ProjectUpdatePage,
} from './types';

const updatesPath = (id: string) => `/staff/tasks/projects/${encodeURIComponent(id)}/updates`;

function Composer({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const zone = useRef<HTMLFormElement>(null);
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState('');
  // One id per update being written, so a double-tap posts once.
  const clientId = useRef(newClientId());

  const send = useMutation({
    mutationFn: () => {
      const body = isRichTextEmpty(text) ? '' : text.trim();
      const path = updatesPath(project.id);
      if (!files.length) return apiClient.post<{ update: ProjectUpdate }>(path, { text: body, clientId: clientId.current });
      const form = new FormData();
      form.append('text', body);
      form.append('clientId', clientId.current);
      for (const f of files) form.append('files', f);
      return sendForm<{ update: ProjectUpdate }>(path, form);
    },
    onSuccess: () => {
      setText('');
      setFiles([]);
      setError('');
      clientId.current = newClientId();
      queryClient.invalidateQueries({ queryKey: taskKeys.projectUpdates(project.id) });
    },
    onError: (e) => setError(errorMessage(e, 'Could not post the update.')),
  });
  const ready = (!isRichTextEmpty(text) || files.length > 0) && !send.isPending;

  const attach = (incoming: File[]) => {
    const picked = pickFiles(incoming, PROJECT_UPDATE_FILES_MAX - files.length, setError, files.reduce((n, f) => n + f.size, 0));
    if (picked.length) setFiles((all) => [...all, ...picked]);
  };
  usePasteFiles(zone, { accept: TASK_FILE_ACCEPT, hasRoom: files.length < PROJECT_UPDATE_FILES_MAX, take: attach });

  return (
    <form ref={zone} onSubmit={(e) => { e.preventDefault(); if (ready) send.mutate(); }}>
      <div className="rounded-xl border border-gray-200 bg-white p-2 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100">
        <RichTextBox
          bare
          compact
          value={text}
          onChange={setText}
          onSubmit={() => { if (ready) send.mutate(); }}
          maxLength={LONG_TEXT_MAX}
          minHeightClass="min-h-[2.75rem]"
          placeholder="Post an update — what was done, what's next. Add photos or a video."
          ariaLabel="Project update"
        />
        {files.length > 0 && (
          <ul className="mb-1 flex flex-wrap gap-1.5 px-1" aria-label="Files to post">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="max-w-full">
                <FileChip
                  file={{ url: '#', name: f.name, mime: f.type, size: f.size, kind: kindOf(f) }}
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
            aria-label="Attach photos, videos or files to the update"
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? []);
              e.target.value = '';
              attach(picked);
            }}
          />
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={files.length >= PROJECT_UPDATE_FILES_MAX}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-800 disabled:opacity-50"
          >
            <Paperclip className="h-4 w-4" aria-hidden /> Photo / video
          </button>
          <button type="submit" disabled={!ready} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
            <Send className="h-4 w-4" aria-hidden /> {send.isPending ? (files.length ? 'Uploading…' : 'Posting…') : 'Post'}
          </button>
        </div>
      </div>
      {error && <p role="alert" className="mt-1 text-sm text-red-600">{error}</p>}
    </form>
  );
}

function UpdateItem({ u, projectId }: { u: ProjectUpdate; projectId: string }) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => apiClient.delete(`${updatesPath(projectId)}/${encodeURIComponent(u.id)}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: taskKeys.projectUpdates(projectId) }),
    onError: (e) => toast.error(errorMessage(e, 'Could not delete the update.')),
  });
  return (
    <li className="flex gap-2.5">
      <Avatar name={u.by || '?'} id={u.byId} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-gray-500">
          <span className="font-semibold text-gray-900">{u.by || 'Someone'}</span>
          {u.at && <time dateTime={u.at}>{formatDateTimeIST(u.at)}</time>}
          {u.canDelete && (
            <button
              type="button"
              onClick={() => { if (window.confirm('Delete this update? Its photos and videos are removed too.')) remove.mutate(); }}
              disabled={remove.isPending}
              aria-label="Delete update"
              title="Delete"
              className="ml-auto rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-600"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </p>
        {u.deleted ? (
          <p className="text-sm italic text-gray-400">This update was deleted.</p>
        ) : (
          <>
            {u.text && <RichText value={u.text} className="text-sm leading-relaxed text-gray-800" />}
            <MediaFiles files={u.files} />
          </>
        )}
      </div>
    </li>
  );
}

export default function ProjectUpdates({ project }: { project: Project }) {
  const q = useInfiniteQuery({
    queryKey: taskKeys.projectUpdates(project.id),
    queryFn: ({ pageParam }) => apiClient.get<ProjectUpdatePage>(
      `${updatesPath(project.id)}${pageParam ? `?before=${encodeURIComponent(pageParam)}` : ''}`,
    ),
    initialPageParam: '' as string,
    getNextPageParam: (last) => last?.nextBefore || undefined,
  });
  const updates = q.data?.pages.flatMap((p) => p?.updates ?? []) ?? [];

  return (
    <section aria-labelledby={`updates-${project.id}`} className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
      <h3 id={`updates-${project.id}`} className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-gray-900">
        <Megaphone aria-hidden className="h-4 w-4 text-gray-500" /> Updates
      </h3>
      {!project.archivedAt && <Composer project={project} />}
      {q.isError && <p role="alert" className="mt-3 text-sm text-red-600">{errorMessage(q.error, 'Could not load the updates.')}</p>}
      {q.isPending ? (
        <p className="mt-3 text-sm text-gray-400">Loading updates…</p>
      ) : updates.length === 0 ? (
        <p className="mt-3 text-sm text-gray-400">No updates yet.</p>
      ) : (
        <ul className="mt-4 space-y-4">
          {updates.map((u) => <UpdateItem key={u.id} u={u} projectId={project.id} />)}
        </ul>
      )}
      {q.hasNextPage && (
        <button type="button" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage} className="mt-3 text-sm font-medium text-blue-700 hover:underline disabled:opacity-50">
          {q.isFetchingNextPage ? 'Loading…' : 'Show older updates'}
        </button>
      )}
    </section>
  );
}
