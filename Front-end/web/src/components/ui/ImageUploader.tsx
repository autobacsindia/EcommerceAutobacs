'use client';
/**
 * ImageUploader — Reusable multi-image gallery editor
 *
 * Presents ONE ordered gallery containing both images already stored on the
 * entity and files the admin just picked, because "sequence" only means
 * anything to an admin if it describes the gallery they will actually ship —
 * splitting saved and pending images into two lists makes the final order
 * unknowable until after save.
 *
 * Ordering: drag a tile onto another to reposition it, or use the ←/→ buttons
 * (keyboard-reachable and reliable on touch, where HTML5 drag is not).
 * Primary: chosen explicitly with the ★ button, independent of position.
 *
 * The parent owns persistence. It receives the full ordered gallery via
 * `onGalleryChange` and uploads `kind: 'new'` files itself, so the Cloudinary
 * API secret never touches the frontend.
 */
import React, { useRef, useState, useCallback, useMemo, useEffect } from 'react';
import Image from 'next/image';
import { X, Upload, Star, ArrowLeft, ArrowRight } from 'lucide-react';
import { IMAGE_ACCEPT, IMAGE_MAX_FILE_MB, IMAGE_MAX_TOTAL_MB, IMAGE_MAX_FILES, validateImageFile } from '@/lib/imageUpload';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CloudinaryImage {
  url:       string;
  public_id: string;
  alt?:      string;
  isPrimary?: boolean;
}

export interface LocalPreview {
  uid:     string;
  file:    File;
  preview: string; // object URL
}

/**
 * One tile in the gallery, saved or pending.
 *
 * `key` is the stable identity the backend also orders by: an existing image's
 * `public_id` (or its URL, for legacy rows that never got one), or a local uid
 * for a file not yet uploaded. The parent translates local uids to their
 * Cloudinary public_ids once the upload completes.
 */
export interface GalleryItem {
  key:  string;
  kind: 'existing' | 'new';
  url:  string;
  alt?: string;
  file?: File;
}

/** Stable key for an already-stored image — mirrors `imageKey()` on the server. */
export const existingImageKey = (img: CloudinaryImage): string => img.public_id || img.url;

interface ImageUploaderProps {
  /** Existing images already saved in DB */
  value?:      CloudinaryImage[];
  /**
   * Called when an existing image is removed, with its stable key and its index
   * in `value`. The key is the image's public_id, or its URL for migrated rows
   * that never got one — the server matches removals on the same key, so those
   * legacy images can be removed too.
   */
  onRemoveExisting?: (key: string, index: number) => void;
  /** Called each time new local files are added, in gallery order */
  onFilesChange?: (files: File[]) => void;
  /** Called with the full ordered gallery whenever it changes */
  onGalleryChange?: (items: GalleryItem[]) => void;
  /** Key of the image marked primary. Uncontrolled when omitted. */
  primaryKey?: string | null;
  /** Called when the admin picks a different primary image */
  onPrimaryChange?: (key: string) => void;
  /** Set false to hide reorder + primary controls (e.g. replace mode) */
  reorderable?: boolean;
  /** Max NEW files one save may add. Must not exceed the server's MAX_NEW_IMAGES. */
  maxFiles?:   number;
  /**
   * Max total gallery size. Defaults to `maxFiles` (the historical behaviour).
   * Raise it wherever a gallery legitimately grows beyond one batch — e.g. a
   * variable product, whose gallery holds marketing shots PLUS one photo per
   * selectable model.
   */
  maxTotal?:   number;
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

let uidCounter = 0;
const nextUid = () => `local-${Date.now()}-${uidCounter++}`;

// ── Component ─────────────────────────────────────────────────────────────────

export default function ImageUploader({
  value = [],
  onRemoveExisting,
  onFilesChange,
  onGalleryChange,
  primaryKey,
  onPrimaryChange,
  reorderable = true,
  maxFiles = IMAGE_MAX_FILES,
  maxTotal,
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
  /** Explicit ordering of tile keys. Keys absent here fall to the end. */
  const [order, setOrder] = useState<string[]>([]);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  const totalCount = value.length + localPreviews.length;

  /*
    ── Two DIFFERENT limits, deliberately separated ──────────────────────────

    `maxFiles` caps how many NEW files one save may add. It mirrors the server's
    MAX_NEW_IMAGES, so it must not drift above it: the server silently truncates
    over-cap refs, which would upload bytes the admin never sees attached.

    `maxTotal` caps how large the gallery may grow. It defaults to `maxFiles`,
    which reproduces the previous behaviour EXACTLY for every existing caller
    (brands, vehicles — all `maxFiles={1}`), so this split changes nothing for
    them.

    They were one number before, and that number locked admins out. Once models
    own photos, a variable product's gallery is legitimately marketing shots PLUS
    one image per model — eleven is normal. With a single cap of 8, `remaining`
    went NEGATIVE on every such product and the uploader refused every further
    image with "You can upload at most 8 images", on exactly the products this
    feature improves. Nothing was lost (existing images are resubmitted intact),
    but the product became uneditable, which is the kind of breakage a manual
    smoke test on a fresh product never sees.
  */
  const totalCeiling = maxTotal ?? maxFiles;
  const batchRemaining = maxFiles - localPreviews.length;
  const totalRemaining = totalCeiling - totalCount;
  const remaining = Math.min(batchRemaining, totalRemaining);

  // A non-finite ceiling disables the combined-size cap — used where images
  // upload straight to Cloudinary and never traverse the proxy request body.
  const enforceTotal = Number.isFinite(maxTotalSizeMB) && maxTotalSizeMB > 0;
  const MAX_TOTAL_BYTES = maxTotalSizeMB * 1024 * 1024;

  // ── The gallery ────────────────────────────────────────────────────────────
  // Derived, never stored: `order` is only a hint applied over the live pool of
  // images. Keys that disappear (a removed image) resolve to nothing, and keys
  // that appear (a newly picked file) land at the end — so the list self-heals
  // instead of needing an effect to reconcile it with `value`.
  const items = useMemo<GalleryItem[]>(() => {
    const pool: GalleryItem[] = [
      ...value.map((img) => ({
        key:  existingImageKey(img),
        kind: 'existing' as const,
        url:  img.url,
        alt:  img.alt,
      })),
      ...localPreviews.map((p) => ({
        key:  p.uid,
        kind: 'new' as const,
        url:  p.preview,
        file: p.file,
      })),
    ];

    const byKey = new Map(pool.map((i) => [i.key, i]));
    const picked: GalleryItem[] = [];
    const seen = new Set<string>();
    for (const key of order) {
      const item = byKey.get(key);
      if (item && !seen.has(key)) {
        picked.push(item);
        seen.add(key);
      }
    }
    return [...picked, ...pool.filter((i) => !seen.has(i.key))];
  }, [value, localPreviews, order]);

  const effectivePrimary = useMemo(() => {
    if (primaryKey && items.some((i) => i.key === primaryKey)) return primaryKey;
    return items[0]?.key ?? null;
  }, [primaryKey, items]);

  // Publish the arrangement upward. New files are reported in gallery order so
  // the parent's upload refs line up with the order it sends to the server.
  //
  // Keyed on a content signature rather than the `items` identity: the parent
  // typically passes an inline `value` array and stores what we publish in its
  // own state, so an identity-keyed effect would re-publish on every parent
  // render and spin (publish → parent setState → render → publish).
  const signature = items.map((i) => `${i.kind}:${i.key}`).join('|');
  const itemsRef = useRef(items);
  itemsRef.current = items;
  useEffect(() => {
    const current = itemsRef.current;
    onGalleryChange?.(current);
    onFilesChange?.(current.filter((i) => i.kind === 'new').map((i) => i.file!));
    // Callbacks are usually inline arrows in the parent — depending on them
    // would defeat the signature guard above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  // ── Add files ──────────────────────────────────────────────────────────────
  // Reject client-side against the *real* constraints (per-file + combined +
  // slot count) so the admin gets a precise message instead of a 3 MB multer
  // 400 or an opaque proxy 413 after the bytes have already been uploaded.
  const addFiles = useCallback((incoming: FileList | File[]) => {
    const files = Array.from(incoming);
    if (!files.length) return;

    if (remaining <= 0) {
      // Name the limit that actually bit. "You can upload at most 8 images" on a
      // gallery of eleven is not just unhelpful, it reads as a bug.
      setError(
        totalRemaining <= 0 && totalCeiling !== maxFiles
          ? `This gallery already has ${totalCount} of ${totalCeiling} images. Remove one to add another.`
          : `You can upload at most ${maxFiles} image${maxFiles === 1 ? '' : 's'} at a time.`
      );
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
      uid:     nextUid(),
      file,
      preview: URL.createObjectURL(file),
    }));

    setLocalPreviews((prev) => [...prev, ...previews]);
  }, [remaining, maxFiles, totalRemaining, totalCeiling, totalCount, enforceTotal, MAX_TOTAL_BYTES, maxFileSizeMB, maxTotalSizeMB, localPreviews]);

  // ── Remove ─────────────────────────────────────────────────────────────────
  const removeLocal = (uid: string) => {
    // Removing a file frees slot/size budget, so any prior rejection message no
    // longer applies — clear it to avoid a stale error next to a valid selection.
    setError(null);
    setLocalPreviews((prev) => {
      const target = prev.find((p) => p.uid === uid);
      if (target) URL.revokeObjectURL(target.preview);
      return prev.filter((p) => p.uid !== uid);
    });
  };

  const removeItem = (item: GalleryItem) => {
    if (item.kind === 'new') {
      removeLocal(item.key);
      return;
    }
    const idx = value.findIndex((img) => existingImageKey(img) === item.key);
    // Report the key, not the raw public_id — a migrated image has none, and
    // an empty string would stage a removal the server could never match.
    if (idx !== -1) onRemoveExisting?.(existingImageKey(value[idx]), idx);
  };

  // ── Reordering ─────────────────────────────────────────────────────────────
  /** Rewrite `order` from the current gallery with `key` moved to `toIndex`. */
  const moveTo = useCallback((key: string, toIndex: number) => {
    const keys = items.map((i) => i.key);
    const from = keys.indexOf(key);
    if (from === -1) return;
    const clamped = Math.max(0, Math.min(keys.length - 1, toIndex));
    if (clamped === from) return;
    keys.splice(from, 1);
    keys.splice(clamped, 0, key);
    setOrder(keys);
  }, [items]);

  const moveBy = (key: string, delta: number) => {
    const from = items.findIndex((i) => i.key === key);
    if (from !== -1) moveTo(key, from + delta);
  };

  const onTileDrop = (targetKey: string) => {
    if (!dragKey || dragKey === targetKey) return;
    const targetIndex = items.findIndex((i) => i.key === targetKey);
    if (targetIndex !== -1) moveTo(dragKey, targetIndex);
    setDragKey(null);
    setDragOverKey(null);
  };

  // ── Drag & drop (files onto the drop zone) ─────────────────────────────────
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

  const showControls = reorderable && !disabled;

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

      {/* ── Gallery ───────────────────────────────────────────────────────── */}
      {items.length > 0 && (
        <>
          {showControls && (
            <p className="text-xs text-gray-500">
              Drag a tile or use ←/→ to set the display order. ★ marks the main image shown in listings.
            </p>
          )}

          <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 list-none p-0 m-0">
            {items.map((item, idx) => {
              const isPrimary = item.key === effectivePrimary;
              return (
                <li
                  key={item.key}
                  draggable={showControls}
                  onDragStart={() => showControls && setDragKey(item.key)}
                  onDragEnd={() => { setDragKey(null); setDragOverKey(null); }}
                  onDragOver={(e) => {
                    if (!showControls || !dragKey) return;
                    e.preventDefault();
                    e.stopPropagation();
                    setDragOverKey(item.key);
                  }}
                  onDrop={(e) => {
                    if (!showControls) return;
                    e.preventDefault();
                    e.stopPropagation();
                    onTileDrop(item.key);
                  }}
                  data-testid={`gallery-item-${idx}`}
                  className={`
                    relative group aspect-square rounded-lg overflow-hidden bg-gray-50
                    ${item.kind === 'new' ? 'ring-2 ring-yellow-400/50' : ''}
                    ${isPrimary ? 'ring-2 ring-red-500' : ''}
                    ${dragKey === item.key ? 'opacity-40' : ''}
                    ${dragOverKey === item.key && dragKey !== item.key ? 'ring-2 ring-blue-500' : ''}
                    ${showControls ? 'cursor-move' : ''}
                  `}
                >
                  {item.kind === 'existing' ? (
                    <Image
                      src={item.url}
                      alt={item.alt || `Image ${idx + 1}`}
                      fill
                      className="object-cover pointer-events-none"
                      sizes="120px"
                    />
                  ) : (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={item.url}
                      alt={`Preview ${idx + 1}`}
                      className="w-full h-full object-cover pointer-events-none"
                    />
                  )}

                  {/* Position badge — the number that actually ships */}
                  <span className="absolute top-1 left-1 flex h-4 min-w-4 items-center justify-center rounded bg-black/60 px-1 text-[10px] font-medium text-white">
                    {idx + 1}
                  </span>

                  {isPrimary && (
                    <span className="absolute bottom-1 left-1 rounded bg-red-600 px-1 text-[10px] text-white">
                      Primary
                    </span>
                  )}
                  {item.kind === 'new' && !isPrimary && (
                    <span className="absolute bottom-1 left-1 rounded bg-yellow-500 px-1 text-[10px] font-medium text-gray-900">
                      New
                    </span>
                  )}

                  {!disabled && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); removeItem(item); }}
                      className="absolute top-1 right-1 rounded-full bg-white/70 p-0.5 text-gray-900 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                      aria-label={`Remove image ${idx + 1}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}

                  {showControls && (
                    <div className="absolute inset-x-0 bottom-0 flex items-center justify-end gap-0.5 bg-black/50 p-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onPrimaryChange?.(item.key); }}
                        disabled={isPrimary}
                        className="rounded p-0.5 text-white hover:bg-white/20 disabled:opacity-40"
                        aria-label={`Set image ${idx + 1} as primary`}
                        aria-pressed={isPrimary}
                      >
                        <Star className={`h-3 w-3 ${isPrimary ? 'fill-current' : ''}`} />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); moveBy(item.key, -1); }}
                        disabled={idx === 0}
                        className="rounded p-0.5 text-white hover:bg-white/20 disabled:opacity-40"
                        aria-label={`Move image ${idx + 1} earlier`}
                      >
                        <ArrowLeft className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); moveBy(item.key, 1); }}
                        disabled={idx === items.length - 1}
                        className="rounded p-0.5 text-white hover:bg-white/20 disabled:opacity-40"
                        aria-label={`Move image ${idx + 1} later`}
                      >
                        <ArrowRight className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
