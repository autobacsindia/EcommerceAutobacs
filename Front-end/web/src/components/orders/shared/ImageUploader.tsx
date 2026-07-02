'use client';

import { useState, useRef } from 'react';
import { Upload, X, AlertCircle, Loader2, Image as ImageIcon } from 'lucide-react';
import { IMAGE_UPLOAD } from '@/lib/constants';

interface UploadedImage {
  url: string;
  description?: string;
  file?: File;
}

interface ImageUploaderProps {
  images: UploadedImage[];
  onImagesChange: (images: UploadedImage[]) => void;
  maxImages?: number;
  maxFileSize?: number;
}

export default function ImageUploader({
  images,
  onImagesChange,
  maxImages = IMAGE_UPLOAD.MAX_FILES,
  maxFileSize = IMAGE_UPLOAD.MAX_FILE_SIZE,
}: ImageUploaderProps) {
  const [dragActive, setDragActive] = useState(false);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validateFile = (file: File): string | null => {
    // Check file type - cast to any array for includes check
    const acceptedTypes: any = IMAGE_UPLOAD.ACCEPTED_FORMATS;
    if (!acceptedTypes.includes(file.type)) {
      return `${file.name}: Invalid file type. Only JPG, PNG, and WebP are allowed.`;
    }

    // Check file size
    if (file.size > maxFileSize) {
      return `${file.name}: File size exceeds ${(maxFileSize / (1024 * 1024)).toFixed(0)}MB limit.`;
    }

    return null;
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const newErrors: string[] = [];
    const validFiles: File[] = [];

    // Validate all files first
    Array.from(files).forEach((file) => {
      const error = validateFile(file);
      if (error) {
        newErrors.push(error);
      } else {
        validFiles.push(file);
      }
    });

    // Check if adding these files would exceed max
    if (images.length + validFiles.length > maxImages) {
      newErrors.push(`Maximum ${maxImages} images allowed. You're trying to add ${validFiles.length} more to existing ${images.length}.`);
      setErrors(newErrors);
      return;
    }

    setErrors(newErrors);

    // Process valid files
    if (validFiles.length > 0) {
      setUploadingCount(validFiles.length);

      try {
        const uploadedImages: UploadedImage[] = [];

        for (const file of validFiles) {
          // Create object URL for preview (client-side only)
          const objectUrl = URL.createObjectURL(file);
          
          // For now, use object URL as the image URL
          // In production, you would upload to a storage service here
          uploadedImages.push({
            url: objectUrl,
            file: file,
          });
        }

        onImagesChange([...images, ...uploadedImages]);
      } catch (error: any) {
        setErrors([...newErrors, `Upload failed: ${error.message}`]);
      } finally {
        setUploadingCount(0);
      }
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFiles(e.target.files);
  };

  const removeImage = (index: number) => {
    const newImages = [...images];
    const removed = newImages.splice(index, 1)[0];
    
    // Revoke object URL to free memory
    if (removed.url.startsWith('blob:')) {
      URL.revokeObjectURL(removed.url);
    }
    
    onImagesChange(newImages);
  };

  const updateImageDescription = (index: number, description: string) => {
    const newImages = [...images];
    newImages[index] = { ...newImages[index], description };
    onImagesChange(newImages);
  };

  const canAddMore = images.length < maxImages;

  return (
    <div className="space-y-4">
      {/* Upload Area */}
      {canAddMore && (
        <div
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition ${
            dragActive
              ? 'border-gold bg-gold/10'
              : 'border-hairline hover:border-hairline hover:bg-obsidian-deep'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={IMAGE_UPLOAD.ACCEPTED_EXTENSIONS.join(',')}
            onChange={handleFileInput}
            className="hidden"
          />

          {uploadingCount > 0 ? (
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-12 w-12 text-gold animate-spin" />
              <p className="text-sm font-medium text-ink/80">
                Uploading {uploadingCount} image{uploadingCount > 1 ? 's' : ''}...
              </p>
            </div>
          ) : (
            <>
              <Upload className="h-12 w-12 text-ink-muted mx-auto mb-4" />
              <p className="text-sm font-medium text-ink/80 mb-1">
                Click to upload or drag and drop
              </p>
              <p className="text-xs text-ink-muted">
                JPG, PNG or WebP (max {(maxFileSize / (1024 * 1024)).toFixed(0)}MB per file)
              </p>
              <p className="text-xs text-ink-muted mt-1">
                {images.length} of {maxImages} images uploaded
              </p>
            </>
          )}
        </div>
      )}

      {/* Error Messages */}
      {errors.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex gap-2">
            <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-red-900 mb-1">Upload Errors</p>
              <ul className="text-sm text-red-800 space-y-1">
                {errors.map((error, index) => (
                  <li key={index}>• {error}</li>
                ))}
              </ul>
            </div>
            <button
              onClick={() => setErrors([])}
              className="text-red-600 hover:text-red-800 transition"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}

      {/* Image Preview Grid */}
      {images.length > 0 && (
        <div className="space-y-4">
          <p className="text-sm font-medium text-ink/80">
            Uploaded Images ({images.length}/{maxImages})
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {images.map((image, index) => (
              <div key={index} className="border border-hairline rounded-lg p-3 bg-obsidian">
                {/* Image Preview */}
                <div className="relative aspect-video bg-obsidian-raised rounded-lg overflow-hidden mb-3">
                  <img
                    src={image.url}
                    alt={`Upload ${index + 1}`}
                    className="w-full h-full object-cover"
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeImage(index);
                    }}
                    className="absolute top-2 right-2 p-1.5 bg-red-600 text-ink rounded-full hover:bg-red-700 transition shadow-lg"
                    title="Remove image"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* Description Input */}
                <input
                  type="text"
                  value={image.description || ''}
                  onChange={(e) => updateImageDescription(index, e.target.value)}
                  placeholder="Add description (optional)"
                  className="w-full px-3 py-2 text-sm border border-hairline rounded-lg focus:outline-none focus:ring-2 focus:ring-gold"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Help Text */}
      {images.length === 0 && (
        <div className="bg-gold/10 border border-gold/40 rounded-lg p-4">
          <div className="flex gap-2">
            <ImageIcon className="h-5 w-5 text-gold flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-gold mb-1">Why upload images?</p>
              <p className="text-sm text-gold">
                Clear photos help us process your return faster and ensure you get the best resolution.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
