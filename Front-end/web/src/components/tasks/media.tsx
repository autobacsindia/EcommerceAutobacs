'use client';

/**
 * Files on task comments, task files and project updates: picking them (with
 * the server's limits checked up front), sending them, and showing them —
 * photos as pictures, videos as a player, everything else as a chip.
 *
 * Every address here is on our API (/api/v1/staff/tasks/…/files/…), which
 * checks the viewer may see the task or project before it answers. A video's
 * address answers with a short-lived private link the player can seek in.
 */
import { useState } from 'react';
import { Download, X } from 'lucide-react';
import { submitMultipart, parseApiResponse } from '@/lib/multipartResponse';
import {
  acceptsFile, isVideoFile, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_TOTAL_BYTES, MAX_VIDEO_ATTACHMENT_BYTES, mb,
} from '@/lib/attachments';
import { FileKindIcon, fileSize } from '@/components/chat/chatUi';
import { TASK_FILE_ACCEPT, type TaskFile } from './types';

/** Send a form with files (apiClient only speaks JSON); same cookies and CSRF header. */
export async function sendForm<T>(path: string, form: FormData): Promise<T> {
  const res = await submitMultipart(`/api/v1${path}`, 'POST', form);
  const body = await parseApiResponse(res);
  if (!res.ok) {
    const message = (body as { message?: string }).message || 'Could not upload the files.';
    // `rawData` is where errorMessage() (and apiClient's errors) carry the server's words,
    // so "videos can be up to 40 MB" reaches the person instead of a generic line.
    throw Object.assign(new Error(message), { rawData: { message }, status: res.status });
  }
  return body as unknown as T;
}

const capFor = (f: File) => (isVideoFile(f) ? MAX_VIDEO_ATTACHMENT_BYTES : MAX_ATTACHMENT_BYTES);

/**
 * Keep the files the server would take; say why the rest were left out.
 * `room` is how many more fit; `usedBytes` what is already waiting in the same
 * upload (one upload carries at most MAX_ATTACHMENTS_TOTAL_BYTES).
 */
export function pickFiles(
  incoming: FileList | File[] | null,
  room: number,
  onError: (msg: string) => void,
  usedBytes = 0,
): File[] {
  const all = Array.from(incoming ?? []);
  const wrong = all.find((f) => !acceptsFile(f, TASK_FILE_ACCEPT));
  if (wrong) onError(`"${wrong.name}" can't be attached — photos, videos (MP4, MOV, WebM), PDFs, spreadsheets, Word or text files only.`);
  const list = all.filter((f) => acceptsFile(f, TASK_FILE_ACCEPT));
  const tooBig = list.find((f) => f.size > capFor(f));
  if (tooBig) {
    onError(isVideoFile(tooBig)
      ? `"${tooBig.name}" is ${mb(tooBig.size)} — videos can be up to ${mb(MAX_VIDEO_ATTACHMENT_BYTES)}. Send a shorter clip.`
      : `"${tooBig.name}" is over ${mb(MAX_ATTACHMENT_BYTES)} and was not added.`);
  }
  const fitting: File[] = [];
  let total = usedBytes;
  let overTotal = false;
  for (const f of list) {
    if (f.size > capFor(f)) continue;
    if (total + f.size > MAX_ATTACHMENTS_TOTAL_BYTES) { overTotal = true; continue; }
    fitting.push(f);
    total += f.size;
  }
  if (overTotal) onError(`One post can carry up to ${mb(MAX_ATTACHMENTS_TOTAL_BYTES)} of files. Send the rest in the next one.`);
  if (fitting.length > room) onError(room > 0 ? `Only ${room} more file${room === 1 ? '' : 's'} fit here.` : 'No more files fit here.');
  return fitting.slice(0, Math.max(room, 0));
}

/** What kind a picked (not yet sent) file is, for its chip. */
export const kindOf = (f: File): TaskFile['kind'] =>
  (isVideoFile(f) ? 'video' : (f.type || '').startsWith('image/') ? 'image' : 'file');

/** The address that saves a file instead of opening it (the server answers it as an attachment). */
export const downloadUrl = (url: string) => `${url}${url.includes('?') ? '&' : '?'}download=1`;

const iconButton = 'grid h-7 w-7 shrink-0 place-items-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-800 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600';

/**
 * One file: its picture or kind, its name (opens it to view), its size, and a
 * download button. A file still waiting to be sent (`url` "#") has no address yet,
 * so it only shows and can be taken off.
 */
export function FileChip({ file, onRemove }: { file: TaskFile; onRemove?: () => void }) {
  const saved = file.url !== '#';
  return (
    <span className="group/file inline-flex max-w-full items-center gap-2 rounded-xl border border-gray-200 bg-white py-1 pl-1 pr-1 text-xs shadow-xs transition-colors hover:border-gray-300">
      {file.kind === 'image' && saved ? (
        // eslint-disable-next-line @next/next/no-img-element -- private, cookie-authenticated bytes; next/image cannot fetch them
        <img src={file.url} alt="" loading="lazy" decoding="async" className="h-9 w-9 shrink-0 rounded-lg object-cover" />
      ) : (
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gray-50"><FileKindIcon mime={file.mime} className="h-5 w-5 text-gray-500" /></span>
      )}
      <span className="flex min-w-0 flex-col">
        {saved ? (
          <a href={file.url} target="_blank" rel="noopener noreferrer" title={`Open ${file.name}`} className="min-w-0 truncate font-medium text-gray-800 hover:underline">{file.name}</a>
        ) : (
          <span className="min-w-0 truncate font-medium text-gray-800">{file.name}</span>
        )}
        <span className="text-[11px] text-gray-400">{fileSize(file.size)}</span>
      </span>
      {saved && (
        <a href={downloadUrl(file.url)} download={file.name} aria-label={`Download ${file.name}`} title="Download" className={iconButton}>
          <Download aria-hidden className="h-4 w-4" />
        </a>
      )}
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`Remove ${file.name}`} title="Remove" className={iconButton}>
          <X className="h-4 w-4" />
        </button>
      )}
    </span>
  );
}

/**
 * A video with a player. Some clips can't play in some browsers (an iPhone's
 * HEVC .mov in Chrome on Windows): the player then gives way to a "download it"
 * line, and the download link is always there.
 */
export function VideoPlayer({ file }: { file: TaskFile }) {
  const [broken, setBroken] = useState(false);
  return (
    <figure className="max-w-full" data-testid="task-video">
      {broken ? (
        <p className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
          This video can’t play in this browser. Download it to watch.
        </p>
      ) : (
        <video
          src={file.url}
          controls
          playsInline
          preload="metadata"
          onError={() => setBroken(true)}
          className="block max-h-72 w-[360px] max-w-full rounded-xl border border-gray-200 bg-black"
          aria-label={file.name}
        />
      )}
      <figcaption className="mt-1 flex items-center gap-2 text-xs text-gray-500">
        <span className="min-w-0 truncate">{file.name} · {fileSize(file.size)}</span>
        <a href={downloadUrl(file.url)} download={file.name} className="inline-flex shrink-0 items-center gap-1 font-medium text-blue-700 hover:underline">
          <Download className="h-3.5 w-3.5" aria-hidden /> Download
        </a>
      </figcaption>
    </figure>
  );
}

/** A photo, shown as a picture that opens full size. */
function Photo({ file }: { file: TaskFile }) {
  return (
    <a href={file.url} target="_blank" rel="noopener noreferrer" title={`Open ${file.name}`} className="block overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
      {/* eslint-disable-next-line @next/next/no-img-element -- private, cookie-authenticated bytes; next/image cannot fetch them */}
      <img src={file.url} alt={file.name} className="block h-32 w-32 object-cover sm:h-40 sm:w-40" />
    </a>
  );
}

/** The files of one comment or update: photos and videos shown, the rest as chips. */
export function MediaFiles({ files }: { files: TaskFile[] }) {
  if (!files.length) return null;
  const photos = files.filter((f) => f.kind === 'image');
  const videos = files.filter((f) => f.kind === 'video');
  const others = files.filter((f) => f.kind !== 'image' && f.kind !== 'video');
  return (
    <div className="mt-1.5 space-y-2">
      {photos.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Photos">
          {photos.map((f) => <li key={f.url}><Photo file={f} /></li>)}
        </ul>
      )}
      {videos.map((f) => <VideoPlayer key={f.url} file={f} />)}
      {others.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {others.map((f) => <li key={f.url} className="max-w-full"><FileChip file={f} /></li>)}
        </ul>
      )}
    </div>
  );
}
