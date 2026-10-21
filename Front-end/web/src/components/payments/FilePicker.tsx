'use client';

import { X } from 'lucide-react';

/** Same as the server's per-file limit (MAX_PROOF_PHOTO_SIZE). */
export const MAX_FILE_BYTES = 8 * 1024 * 1024;

/**
 * Attach up to `max` files, one pick at a time or several at once — phones often
 * only let you choose one photo per pick, so each pick ADDS to the list. Each
 * file can be removed before sending. The server re-checks count, size and type.
 */
export default function FilePicker({
  files,
  onChange,
  max,
  accept,
  label,
  icon,
  onError,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  max: number;
  accept: string;
  /** Button text and the input's accessible name, e.g. "Attach bill / invoice". */
  label: string;
  icon: React.ReactNode;
  onError: (message: string) => void;
}) {
  function add(picked: FileList | null) {
    const chosen = Array.from(picked || []);
    if (!chosen.length) return;
    const tooBig = chosen.find((f) => f.size > MAX_FILE_BYTES);
    if (tooBig) { onError(`"${tooBig.name}" is too large (8 MB maximum).`); return; }
    const next = [...files, ...chosen];
    if (next.length > max) { onError(`You can attach up to ${max} files here.`); return; }
    onError('');
    onChange(next);
  }

  return (
    <div className="space-y-2">
      {files.length < max && (
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-gray-700 hover:bg-gray-50">
          {icon} {files.length ? `${label} (${files.length}/${max})` : label}
          <input
            type="file"
            multiple
            accept={accept}
            className="sr-only"
            aria-label={label}
            // Reset so picking the same file again (after removing it) still fires onChange.
            onChange={(e) => { add(e.target.files); e.target.value = ''; }}
          />
        </label>
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
