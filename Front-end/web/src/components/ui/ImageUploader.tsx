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
  maxFiles = 10,
  label = 'Upload Images',
  accept = 'image/jpeg,image/png,image/webp',
  disabled = false,
  className = '',
}: ImageUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [localPreviews, setLocalPreviews] = useState<LocalPreview[]>([]);
  const [dragging, setDragging] = useState(false);

  const totalCount = value.length + localPreviews.length;
  const remaining  = maxFiles - totalCount;

  // ── Add files ──────────────────────────────────────────────────────────────
  const addFiles = useCallback((incoming: FileList | File[]) => {
    const files = Array.from(incoming);
    const allowed = files.slice(0, Math.max(remaining, 0));
    if (!allowed.length) return;

    const previews: LocalPreview[] = allowed.map((file) => ({
      file,
      preview: URL.createObjectURL(file),
    }));

    setLocalPreviews((prev) => {
      const next = [...prev, ...previews];
      onFilesChange?.(next.map((p) => p.file));
      return next;
    });
  }, [remaining, onFilesChange]);

  // ── Remove local preview ───────────────────────────────────────────────────
  const removeLocal = (idx: number) => {
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
        <label className="block text-sm font-medium text-ink/70">{label}</label>
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
            : 'border-gray-600 hover:border-gray-400 bg-obsidian-raised/50'}
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        `}
      >
        <Upload className="h-8 w-8 text-ink-muted" />
        <p className="text-sm text-ink-muted">
          Drag &amp; drop or <span className="text-red-400 font-medium">browse</span>
        </p>
        <p className="text-xs text-ink-muted">
          JPG, PNG, WebP · max 5 MB · {remaining} slot{remaining !== 1 ? 's' : ''} remaining
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple
          disabled={disabled}
          className="sr-only"
          onChange={(e) => e.target.files && addFiles(e.target.files)}
        />
      </div>

      {/* ── Image grid ────────────────────────────────────────────────────── */}
      {(value.length > 0 || localPreviews.length > 0) && (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
          {/* Existing Cloudinary images */}
          {value.map((img, idx) => (
            <div key={img.public_id || idx} className="relative group aspect-square rounded-lg overflow-hidden bg-obsidian-raised">
              <Image
                src={img.url}
                alt={img.alt || `Image ${idx + 1}`}
                fill
                className="object-cover"
                sizes="120px"
              />
              {img.isPrimary && (
                <span className="absolute top-1 left-1 text-[10px] bg-red-600 text-ink px-1 rounded">
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
                  className="absolute top-1 right-1 p-0.5 rounded-full bg-obsidian-deep/60 text-ink opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-label="Remove image"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}

          {/* Local previews (not yet uploaded) */}
          {localPreviews.map((p, idx) => (
            <div key={p.preview} className="relative group aspect-square rounded-lg overflow-hidden bg-obsidian-raised ring-2 ring-yellow-400/50">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.preview}
                alt={`Preview ${idx + 1}`}
                className="w-full h-full object-cover"
              />
              <span className="absolute bottom-1 left-1 text-[10px] bg-yellow-500 text-ink px-1 rounded font-medium">
                New
              </span>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => removeLocal(idx)}
                  className="absolute top-1 right-1 p-0.5 rounded-full bg-obsidian-deep/60 text-ink opacity-0 group-hover:opacity-100 transition-opacity"
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
