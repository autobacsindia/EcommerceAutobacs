/**
 * Files on the clipboard — what Ctrl/Cmd+V of a screenshot carries. Pure helpers:
 * no DOM listeners here (see hooks/usePasteFiles.ts).
 */

/** The files a paste carries. Browsers expose them as `files`, older ones only as `items`. */
export function filesFromClipboard(data: Pick<DataTransfer, 'files' | 'items'> | null | undefined): File[] {
  if (!data) return [];
  const direct = Array.from(data.files ?? []);
  if (direct.length) return direct;
  return Array.from(data.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((f): f is File => !!f);
}

/**
 * Whether a file matches an `<input accept>` list: exact MIME types
 * (`image/png`), wildcards (`image/*`) and extensions (`.xlsx`). An empty list
 * accepts anything, as the input does.
 */
export function matchesAccept(file: Pick<File, 'name' | 'type'>, accept: string): boolean {
  const tokens = accept.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (!tokens.length) return true;
  const type = (file.type || '').toLowerCase();
  const name = (file.name || '').toLowerCase();
  return tokens.some((t) => {
    if (t.startsWith('.')) return name.endsWith(t);
    if (t.endsWith('/*')) return type.startsWith(t.slice(0, -1));
    return type === t;
  });
}

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

/**
 * A pasted screenshot arrives named "image.png" — every one of them. Give it a name
 * that says what it is and tells two pastes apart; a real file name is kept.
 */
export function namePastedFile(file: File, now = new Date()): File {
  if (!/^image\.\w+$/i.test(file.name) && file.name) return file;
  const stamp = [now.getHours(), now.getMinutes(), now.getSeconds()].map((n) => String(n).padStart(2, '0')).join('-');
  const ext = EXT[file.type] || file.name.split('.').pop() || 'png';
  return new File([file], `screenshot-${stamp}.${ext}`, { type: file.type, lastModified: file.lastModified });
}
