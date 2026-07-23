'use client';
/**
 * SingleImageUpload — one-image picker that uploads straight to Cloudinary.
 *
 * Unlike the multi-image `ImageUploader` (which defers the upload to the parent
 * form's FormData), this control owns a single URL string: the parent passes the
 * current `value` (a Cloudinary secure_url or ''), and `onUpload` fires with the
 * chosen File so the parent can call `uploadImageToCloudinary` and store the
 * resulting URL. Kept deliberately small for the admin forms (blog cover, gallery
 * media) that persist just a `coverImage`/`url` string, not an image array.
 *
 * The parent drives `uploading`/`error` so the actual upload + validation stays
 * in one place (the shared signed helper) and the API secret never reaches here.
 */
import { ImageIcon } from 'lucide-react';
import { IMAGE_ACCEPT, IMAGE_MAX_FILE_MB } from '@/lib/imageUpload';

interface SingleImageUploadProps {
  /** Current image URL (empty string when none). */
  value: string;
  /** Fired with the picked file — parent performs the actual signed upload. */
  onUpload: (file: File) => void;
  /** Clears the current image. */
  onRemove: () => void;
  uploading?: boolean;
  error?: string | null;
  label?: string;
  disabled?: boolean;
}

export default function SingleImageUpload({
  value,
  onUpload,
  onRemove,
  uploading = false,
  error = null,
  label = 'Image',
  disabled = false,
}: SingleImageUploadProps) {
  const busy = uploading || disabled;

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onUpload(file);
    e.target.value = ''; // allow re-selecting the same file after a rejection
  };

  return (
    <div>
      <label className="text-sm font-medium text-gray-700 block mb-1">{label}</label>
      {value ? (
        <div className="flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value}
            alt="Preview"
            className="h-24 w-40 rounded-lg object-cover border border-gray-200 bg-gray-50"
          />
          <div className="flex flex-col gap-2">
            <label className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-200 rounded-lg w-max ${busy ? 'opacity-60 cursor-wait' : 'cursor-pointer hover:bg-gray-50'}`}>
              <ImageIcon className="h-4 w-4" />
              {uploading ? 'Uploading…' : 'Replace'}
              <input type="file" accept={IMAGE_ACCEPT} disabled={busy} className="sr-only" onChange={pick} />
            </label>
            <button
              type="button"
              onClick={onRemove}
              disabled={busy}
              className="text-sm text-red-600 hover:underline w-max disabled:opacity-60"
            >
              Remove
            </button>
          </div>
        </div>
      ) : (
        <label className={`flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-gray-200 p-6 text-center ${busy ? 'opacity-60 cursor-wait' : 'cursor-pointer hover:border-gray-300 bg-gray-50/50'}`}>
          <ImageIcon className="h-6 w-6 text-gray-500" />
          <span className="text-sm text-gray-500">
            {uploading ? 'Uploading…' : <>Click to upload · <span className="text-red-500 font-medium">browse</span></>}
          </span>
          <span className="text-xs text-gray-400">JPG, PNG, WebP · max {IMAGE_MAX_FILE_MB} MB</span>
          <input type="file" accept={IMAGE_ACCEPT} disabled={busy} className="sr-only" onChange={pick} />
        </label>
      )}
      {error && <p role="alert" className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
}
