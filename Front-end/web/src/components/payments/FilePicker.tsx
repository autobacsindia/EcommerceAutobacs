'use client';

import { useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { usePasteFiles, usePasteShortcut } from '@/hooks/usePasteFiles';
import { acceptsFile, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_TOTAL_BYTES, mb, needsShrink, shrinkForUpload } from '@/lib/attachments';

/** Same as the server's per-file limit (config/attachments.js MAX_ATTACHMENT_BYTES). */
export const MAX_FILE_BYTES = MAX_ATTACHMENT_BYTES;

/**
 * Attach up to `max` files, one pick at a time or several at once — phones often
 * only let you choose one photo per pick, so each pick ADDS to the list and the
 * button then says "Add another". Each file can be removed before sending. Big
 * phone photos are shrunk as they are added (PDFs are left as they are), and the
 * size limits are checked on the shrunk file. The server re-checks count, size
 * and type.
 *
 * A screenshot can also be pasted (Ctrl/Cmd+V) — it goes through the same checks
 * as a chosen file. With `max={1}` a paste replaces the file already attached.
 *
 * The type is checked for chosen files too, not only pasted ones: Chrome on
 * Windows always offers "All files" in its file window, so `accept` alone does
 * not stop a PDF reaching a photo-only picker — it used to go all the way to the
 * server and come back as an error.
 */
export default function FilePicker({
  files,
  onChange,
  max,
  accept,
  label,
  inputLabel,
  icon,
  onError,
  maxBytes = MAX_FILE_BYTES,
  wrongType,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  max: number;
  accept: string;
  /** Button text and the input's accessible name, e.g. "Attach bill / invoice". */
  label: string;
  /** The input's accessible name when it should differ from the button text. */
  inputLabel?: string;
  icon: React.ReactNode;
  onError: (message: string) => void;
  /** Per-file limit, checked after a big photo has been shrunk. */
  maxBytes?: number;
  /** What to say when a file of the wrong type is chosen or pasted (default: what this picker takes). */
  wrongType?: (file: File) => string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const shortcut = usePasteShortcut();
  const [preparing, setPreparing] = useState(false);
  const takesPdf = accept.includes('application/pdf');

  /** Size checks run on the files as they will be sent (after shrinking). */
  function finish(kept: File[], ready: File[]) {
    const tooBig = ready.find((f) => f.size > maxBytes);
    if (tooBig) { onError(`"${tooBig.name}" is too large (${mb(maxBytes)} maximum).`); return; }
    const next = [...kept, ...ready];
    if (next.reduce((sum, f) => sum + f.size, 0) > MAX_ATTACHMENTS_TOTAL_BYTES) {
      onError(`These files add up to more than ${mb(MAX_ATTACHMENTS_TOTAL_BYTES)}. Send fewer at a time.`);
      return;
    }
    onError('');
    onChange(next);
  }

  function add(picked: FileList | File[] | null, { pasted = false } = {}) {
    const chosen = Array.from(picked || []);
    if (!chosen.length || preparing) return;
    const wrong = chosen.find((f) => !acceptsFile(f, accept));
    if (wrong) {
      onError(wrongType ? wrongType(wrong) : `"${wrong.name}" can't be attached here — ${takesPdf ? 'only a photo (JPG, PNG, WebP) or a PDF' : 'only a photo (JPG, PNG or WebP)'}.`);
      return;
    }
    const kept = pasted && max === 1 ? [] : files;
    if (kept.length + chosen.length > max) { onError(max === 1 ? 'You can attach one file here.' : `You can attach up to ${max} files here.`); return; }
    // Nothing to shrink (PDFs, screenshots under 1.5 MB): attach straight away.
    if (!chosen.some(needsShrink)) { finish(kept, chosen); return; }
    setPreparing(true);
    Promise.all(chosen.map((f) => shrinkForUpload(f)))
      .then((ready) => finish(kept, ready))
      .finally(() => setPreparing(false));
  }

  usePasteFiles(root, { accept, hasRoom: !preparing && (max === 1 || files.length < max), take: (pasted) => add(pasted, { pasted: true }) });

  return (
    <div ref={root} className="space-y-2">
      {files.length < max && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <label className={`inline-flex items-center gap-2 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-gray-700 ${preparing ? 'cursor-wait opacity-70' : 'cursor-pointer hover:bg-gray-50'}`}>
            {preparing ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
            {preparing ? 'Preparing…' : files.length ? `Add another (${files.length} of ${max})` : label}
            <input
              type="file"
              multiple={max > 1}
              accept={accept}
              disabled={preparing}
              className="sr-only"
              aria-label={inputLabel ?? label}
              // Reset so picking the same file again (after removing it) still fires onChange.
              onChange={(e) => { const picked = Array.from(e.target.files || []); e.target.value = ''; add(picked); }}
            />
          </label>
          {/* Phones have no Ctrl+V: the hint is for a mouse and keyboard. */}
          <span className="hidden text-xs text-gray-500 pointer-fine:inline">or paste a screenshot ({shortcut})</span>
        </div>
      )}
      {max > 1 && files.length === 0 && (
        <p className="text-xs text-gray-500">
          Up to {max} files{takesPdf ? ' — photos or PDFs' : ' — photos'}, {mb(Math.min(maxBytes, MAX_ATTACHMENT_BYTES))} each.
        </p>
      )}
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {files.map((f, i) => (
            <li key={`${f.name}-${f.size}-${i}`} className="inline-flex max-w-full items-center gap-1 rounded-full bg-gray-100 py-1 pl-3 pr-1 text-xs text-gray-800">
              <span className="truncate">{f.name}</span>
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => onChange(files.filter((_, j) => j !== i))}
                className="rounded-full p-0.5 text-gray-500 hover:bg-gray-200 hover:text-gray-800">
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
