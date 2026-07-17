/**
 * Shared client-side image-upload constraints for admin forms.
 *
 * These MUST stay aligned with the backend so an admin never gets a surprise
 * rejection after the bytes have already been sent:
 *   - Per-file 3 MB matches multer `MAX_FILE_SIZE` (uploadMiddleware.js).
 *   - Combined 4 MB stays below the ~4.5 MB proxy (Vercel) request-body limit
 *     that otherwise returns an opaque plain-text "Request Entity Too Large".
 *   - Accepted types match multer's MIME allowlist (no GIF).
 */
export const IMAGE_MAX_FILE_MB = 3;
export const IMAGE_MAX_TOTAL_MB = 4;
export const IMAGE_MAX_FILES = 8;

export const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp';
const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

/**
 * Validate a single image file against type + size limits.
 * Returns a user-facing error string, or null when the file is acceptable.
 */
export function validateImageFile(
  file: File,
  maxFileMB: number = IMAGE_MAX_FILE_MB,
): string | null {
  if (!ALLOWED_TYPES.includes(file.type)) {
    return `"${file.name}" is not a supported image — use JPG, PNG or WebP.`;
  }
  if (file.size > maxFileMB * 1024 * 1024) {
    return `"${file.name}" is over ${maxFileMB} MB. Compress it and try again.`;
  }
  return null;
}
