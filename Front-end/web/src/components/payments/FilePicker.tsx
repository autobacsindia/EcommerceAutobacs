'use client';

import { useRef } from 'react';
import { X } from 'lucide-react';
import { matchesAccept } from '@/lib/clipboardFiles';
import { usePasteFiles, usePasteShortcut } from '@/hooks/usePasteFiles';

/** Same as the server's per-file limit (MAX_PROOF_PHOTO_SIZE). */
export const MAX_FILE_BYTES = 8 * 1024 * 1024;

/**
 * Attach up to `max` files, one pick at a time or several at once — phones often
 * only let you choose one photo per pick, so each pick ADDS to the list. Each
 * file can be removed before sending. The server re-checks count, size and type.
 *
 * A screenshot can also be pasted (Ctrl/Cmd+V) — it goes through the same checks
 * as a chosen file. With `max={1}` a paste replaces the file already attached.
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
  /** Per-file limit. A photo shrunk before upload (shrinkPhoto) can start larger. */
  maxBytes?: number;
}) {
  const root = useRef<HTMLDivElement>(null);
  const shortcut = usePasteShortcut();

  function add(picked: FileList | File[] | null, { pasted = false } = {}) {
    const chosen = Array.from(picked || []);
    if (!chosen.length) return;
    // A file dialog already filters by `accept`; a paste can carry anything.
    const wrongType = pasted && chosen.find((f) => !matchesAccept(f, accept));
    if (wrongType) { onError(`"${wrongType.name}" can't be attached here.`); return; }
    const tooBig = chosen.find((f) => f.size > maxBytes);
    if (tooBig) { onError(`"${tooBig.name}" is too large (${Math.round(maxBytes / 1024 / 1024)} MB maximum).`); return; }
    const next = pasted && max === 1 ? chosen : [...files, ...chosen];
    if (next.length > max) { onError(max === 1 ? 'You can attach one file here.' : `You can attach up to ${max} files here.`); return; }
    onError('');
    onChange(next);
  }

  usePasteFiles(root, { accept, hasRoom: max === 1 || files.length < max, take: (pasted) => add(pasted, { pasted: true }) });

  return (
    <div ref={root} className="space-y-2">
      {files.length < max && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-gray-700 hover:bg-gray-50">
            {icon} {files.length ? `${label} (${files.length}/${max})` : label}
            <input
              type="file"
              multiple={max > 1}
              accept={accept}
              className="sr-only"
              aria-label={inputLabel ?? label}
              // Reset so picking the same file again (after removing it) still fires onChange.
              onChange={(e) => { add(e.target.files); e.target.value = ''; }}
            />
          </label>
          {/* Phones have no Ctrl+V: the hint is for a mouse and keyboard. */}
          <span className="hidden text-xs text-gray-500 pointer-fine:inline">or paste a screenshot ({shortcut})</span>
        </div>
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
