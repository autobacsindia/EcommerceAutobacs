/**
 * Staff attachment limits — the same numbers as the server's
 * Back-end/server/config/attachments.js. Change both together. The server
 * re-checks everything; these only let the panel say no before a long upload.
 */
import { matchesAccept } from './clipboardFiles';

/** Files in one save (one form submit / one chat message). */
export const MAX_ATTACHMENTS = 20;

/** Each file, after a photo has been shrunk. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** All files in one save together. */
export const MAX_ATTACHMENTS_TOTAL_BYTES = 40 * 1024 * 1024;

/** Files one record can hold over its life (an edit can add more). */
export const MAX_ATTACHMENTS_PER_RECORD = 50;

/** What payment and parcel pickers take: a photo or a PDF. */
export const PHOTO_OR_PDF = 'image/jpeg,image/png,image/webp,application/pdf';
export const PHOTO_ONLY = 'image/jpeg,image/png,image/webp';

export const mb = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;

/**
 * Labels a browser can put on a real PDF besides `application/pdf`. Chrome on
 * Windows takes the label from the PC's own settings, so a PDF can arrive as
 * `application/x-pdf`, or with no useful label at all. The server decides from
 * the file's bytes; this only stops the panel refusing a real PDF up front.
 */
const PDF_LABELS = new Set(['application/pdf', 'application/x-pdf', 'application/acrobat', 'applications/vnd.pdf', 'text/pdf', 'text/x-pdf']);
const NO_LABEL = new Set(['', 'application/octet-stream', 'binary/octet-stream', 'application/unknown']);
const BY_EXTENSION: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

/** The type a file most likely is: its label, or — for an odd or missing label — its extension. */
export function likelyType(file: Pick<File, 'name' | 'type'>): string {
  const type = (file.type || '').toLowerCase();
  const ext = (file.name || '').toLowerCase().split('.').pop() || '';
  if (PDF_LABELS.has(type)) return 'application/pdf';
  if (type === 'image/jpg' || type === 'image/pjpeg') return 'image/jpeg';
  if (NO_LABEL.has(type)) return BY_EXTENSION[ext] || type;
  return type;
}

/** Whether a picker that takes `accept` (exact types, e.g. PHOTO_OR_PDF) should take this file. */
export function acceptsFile(file: Pick<File, 'name' | 'type'>, accept: string): boolean {
  return matchesAccept(file, accept) || matchesAccept({ name: file.name, type: likelyType(file) }, accept);
}

export const isPdf = (file: Pick<File, 'name' | 'type'>) => likelyType(file) === 'application/pdf';

const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** Photos at or under this are sent as they are — a phone screenshot usually is. */
const SEND_AS_IS_BYTES = 1_500_000;

/** Would shrinkForUpload try to make this file smaller? (False when the browser cannot decode images.) */
export function needsShrink(file: File): boolean {
  return PHOTO_TYPES.has(file.type) && file.size > SEND_AS_IS_BYTES && typeof createImageBitmap === 'function';
}

/**
 * Shrink a large phone photo before it is uploaded: longest side ≤ 2400 px, JPEG.
 * 2400 px keeps a photographed A4 bill or a bank screenshot readable; a 12 MP
 * camera photo (~4 MB) comes out around 0.5–1 MB. PDFs, small files, and anything
 * the browser cannot decode are returned untouched — the server still checks them.
 */
export async function shrinkForUpload(file: File, maxSide = 2400, quality = 0.85): Promise<File> {
  if (!needsShrink(file)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob || blob.size >= file.size) return file;
    const base = file.name.replace(/\.[^.]+$/, '') || 'photo';
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg', lastModified: file.lastModified });
  } catch {
    return file;
  }
}
