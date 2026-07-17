'use client';
/**
 * ImageUploader — Reusable multi-image upload component
 *
 * Props:
 *   value        {CloudinaryImage[]}   Current images (from DB)
 *   onChange     (images: File[]) => void  Called when user picks files
 *   onRemove     (index: number) => void   Called when user removes a preview
 *   maxFiles     number (default 10)
 *   label        string
 *   accept       string (default 'image/jpeg,image/png,image/webp')
 *   disabled     boolean
 *
 * The component shows:
 *   - Existing images (secure_url) from `value` with a remove button
 *   - Local previews of newly-selected files (before upload)
 *   - Drop zone
 *
 * Actual upload is handled by the parent form via FormData so the
 * API secret never touches the frontend.
 */
import React, { useRef, useState, useCallback } from 'react';
import Image from 'next/image';
import { X, Upload, ImageIcon } from 'lucide-react';
import { IMAGE_ACCEPT, IMAGE_MAX_FILE_MB, IMAGE_MAX_TOTAL_MB, IMAGE_MAX_FILES, validateImageFile } from '@/lib/imageUpload';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CloudinaryImage {
  url:       string;
  public_id: string;
  alt?:      string;
  isPrimary?: boolean;
}

export interface LocalPreview {
  file:    File;
  preview: string; // object URL
}

interface ImageUploaderProps {
  /** Existing images already saved in DB */
  value?:      CloudinaryImage[];
  /** Called when existing image is removed (passes public_id) */
  onRemoveExisting?: (publicId: string, index: number) => void;
  /** Called each time new local files are added */
  onFilesChange?: (files: File[]) => void;
  maxFiles?:   number;
  /** Per-file size ceiling (MB). Default matches backend multer limit. */
  maxFileSizeMB?: number;
  /**
   * Combined ceiling (MB) across all *new* files in one submit. Defaults below
   * the ~4.5 MB proxy (Vercel) request-body limit so the upload never dies
   * upstream with an opaque "Request Entity Too Large".
   */
  maxTotalSizeMB?: number;
  label?:      string;
  accept?:     string;
  disabled?:   boolean;
  className?:  string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ImageUploader({
  value = [],
  onRemoveExisting,
  onFilesChange,
  maxFiles = IMAGE_MAX_FILES,
  maxFileSizeMB = IMAGE_MAX_FILE_MB,
  maxTotalSizeMB = IMAGE_MAX_TOTAL_MB,
  label = 'Upload Images',
  accept = IMAGE_ACCEPT,
  disabled = false,
  className = '',
}: ImageUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [localPreviews, setLocalPreviews] = useState<LocalPreview[]>([]);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalCount = value.length + localPreviews.length;
  const remaining  = maxFiles - totalCount;

  // A non-finite ceiling disables the combined-size cap — used where images
  // upload straight to Cloudinary and never traverse the proxy request body.
  const enforceTotal = Number.isFinite(maxTotalSizeMB) && maxTotalSizeMB > 0;
  const MAX_TOTAL_BYTES = maxTotalSizeMB * 1024 * 1024;

  // ── Add files ──────────────────────────────────────────────────────────────
  // Reject client-side against the *real* constraints (per-file + combined +
  // slot count) so the admin gets a precise message instead of a 3 MB multer
  // 400 or an opaque proxy 413 after the bytes have already been uploaded.
  const addFiles = useCallback((incoming: FileList | File[]) => {
    const files = Array.from(incoming);
    if (!files.length) return;

    if (remaining <= 0) {
      setError(`You can upload at most ${maxFiles} image${maxFiles === 1 ? '' : 's'}.`);
      return;
    }

    const problems: string[] = [];

    // Slot count
    const withinCount = files.slice(0, remaining);
    if (files.length > remaining) {
      problems.push(`Only ${remaining} more slot${remaining === 1 ? '' : 's'} available — extra files were skipped.`);
    }

    // Per-file type + size (shared validator — one source of truth with the
    // single-file admin forms, so the rules can't drift).
    const sized: File[] = [];
    for (const f of withinCount) {
      const problem = validateImageFile(f, maxFileSizeMB);
      if (problem) problems.push(problem);
      else sized.push(f);
    }

    // Combined size across all pending new files (existing DB images don't
    // count — they're already on Cloudinary and aren't re-uploaded). Skipped
    // entirely when the combined cap is disabled (direct-to-Cloudinary).
    let accepted: File[] = sized;
    if (enforceTotal) {
      accepted = [];
      let running = localPreviews.reduce((sum, p) => sum + p.file.size, 0);
      let totalExceeded = false;
      for (const f of sized) {
        if (running + f.size > MAX_TOTAL_BYTES) { totalExceeded = true; break; }
        running += f.size;
        accepted.push(f);
      }
      if (totalExceeded) {
        problems.push(
          `Combined upload must stay under ${maxTotalSizeMB} MB — compress images or upload fewer at once.`
        );
      }
    }

    setError(problems.length ? problems.join(' ') : null);
    if (!accepted.length) return;

    const previews: LocalPreview[] = accepted.map((file) => ({
      file,
      preview: URL.createObjectURL(file),
    }));

    setLocalPreviews((prev) => {
      const next = [...prev, ...previews];
      onFilesChange?.(next.map((p) => p.file));
      return next;
    });
  }, [remaining, maxFiles, enforceTotal, MAX_TOTAL_BYTES, maxFileSizeMB, maxTotalSizeMB, localPreviews, onFilesChange]);

  // ── Remove local preview ───────────────────────────────────────────────────
  const removeLocal = (idx: number) => {
    // Removing a file frees slot/size budget, so any prior rejection message no
    // longer applies — clear it to avoid a stale error next to a valid selection.
    setError(null);
    setLocalPreviews((prev) => {
      const next = [...prev];
      URL.revokeObjectURL(next[idx].preview);
      next.splice(idx, 1);
      onFilesChange?.(next.map((p) => p.file));
      return next;
    });
  };

  // ── Drag & drop ────────────────────────────────────────────────────────────
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled) setDragging(true);
  };
  const onDragLeave = () => setDragging(false);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (!disabled) addFiles(e.dataTransfer.files);
  };

  return (
    <div className={`space-y-3 ${className}`}>
      {label && (
        <label className="block text-sm font-medium text-gray-700">{label}</label>
      )}

      {/* ── Drop zone ─────────────────────────────────────────────────────── */}
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => !disabled && inputRef.current?.click()}
        className={`
          relative flex flex-col items-center justify-center gap-2
          rounded-xl border-2 border-dashed p-6 text-center cursor-pointer
          transition-colors
          ${dragging
            ? 'border-red-400 bg-red-500/10'
            : 'border-gray-200 hover:border-gray-300 bg-gray-50/50'}
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        `}
      >
        <Upload className="h-8 w-8 text-gray-500" />
        <p className="text-sm text-gray-500">
          Drag &amp; drop or <span className="text-red-400 font-medium">browse</span>
        </p>
        <p className="text-xs text-gray-500">
          JPG, PNG, WebP · max {maxFileSizeMB} MB each{enforceTotal ? ` · ${maxTotalSizeMB} MB total` : ''} · {Math.max(remaining, 0)} slot{remaining !== 1 ? 's' : ''} remaining
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple
          disabled={disabled}
          className="sr-only"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = ''; // allow re-selecting the same file after a rejection
          }}
        />
      </div>

      {error && (
        <p role="alert" className="text-xs text-red-600">{error}</p>
      )}

      {/* ── Image grid ────────────────────────────────────────────────────── */}
      {(value.length > 0 || localPreviews.length > 0) && (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
          {/* Existing Cloudinary images */}
          {value.map((img, idx) => (
            <div key={img.public_id || idx} className="relative group aspect-square rounded-lg overflow-hidden bg-gray-50">
              <Image
                src={img.url}
                alt={img.alt || `Image ${idx + 1}`}
                fill
                className="object-cover"
                sizes="120px"
              />
              {img.isPrimary && (
                <span className="absolute top-1 left-1 text-[10px] bg-red-600 text-white px-1 rounded">
                  Primary
                </span>
              )}
              {onRemoveExisting && !disabled && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveExisting(img.public_id, idx);
                  }}
                  className="absolute top-1 right-1 p-0.5 rounded-full bg-white/60 text-gray-900 opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-label="Remove image"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}

          {/* Local previews (not yet uploaded) */}
          {localPreviews.map((p, idx) => (
            <div key={p.preview} className="relative group aspect-square rounded-lg overflow-hidden bg-gray-50 ring-2 ring-yellow-400/50">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.preview}
                alt={`Preview ${idx + 1}`}
                className="w-full h-full object-cover"
              />
              <span className="absolute bottom-1 left-1 text-[10px] bg-yellow-500 text-gray-900 px-1 rounded font-medium">
                New
              </span>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => removeLocal(idx)}
                  className="absolute top-1 right-1 p-0.5 rounded-full bg-white/60 text-gray-900 opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-label="Remove preview"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
