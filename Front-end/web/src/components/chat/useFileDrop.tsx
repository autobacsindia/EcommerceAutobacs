'use client';

import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { Upload } from 'lucide-react';

/** Is something being dragged that carries files (not text or a link from the page)? */
export const dragHasFiles = (e: Pick<DragEvent, 'dataTransfer'>) =>
  Array.from(e.dataTransfer?.types ?? []).includes('Files');

/**
 * Make an area a drop zone for files dragged in from the computer.
 *
 * Flicker: the browser fires dragenter/dragleave for EVERY child element the
 * pointer crosses, so a plain "dragleave → hide" blinks the overlay as the
 * pointer moves over messages. A depth counter (+1 enter, −1 leave) is only
 * zero when the pointer has really left the area.
 *
 * The handlers stop propagation, so a zone inside another (a thread beside the
 * conversation) takes the files and the outer one never sees them.
 */
export function useFileDrop(onFiles: (files: File[]) => void, enabled = true) {
  const depth = useRef(0);
  const [active, setActive] = useState(false);
  const reset = useCallback(() => {
    depth.current = 0;
    setActive(false);
  }, []);

  // A drag cancelled with Esc, or dropped outside the window, sends no dragleave
  // to us — clear the overlay when the drag ends anywhere.
  useEffect(() => {
    if (!active) return;
    window.addEventListener('dragend', reset);
    window.addEventListener('drop', reset);
    return () => {
      window.removeEventListener('dragend', reset);
      window.removeEventListener('drop', reset);
    };
  }, [active, reset]);

  useEffect(() => {
    if (!enabled) reset();
  }, [enabled, reset]);

  const handlers = {
    onDragEnter: (e: DragEvent) => {
      if (!enabled || !dragHasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      depth.current += 1;
      setActive(true);
    },
    onDragOver: (e: DragEvent) => {
      if (!enabled || !dragHasFiles(e)) return;
      // Without preventDefault here the browser refuses the drop (or opens the file).
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';
    },
    onDragLeave: (e: DragEvent) => {
      if (!enabled || !dragHasFiles(e)) return;
      e.stopPropagation();
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setActive(false);
    },
    onDrop: (e: DragEvent) => {
      if (!enabled || !dragHasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      reset();
      const files = Array.from(e.dataTransfer.files ?? []);
      if (files.length) onFiles(files);
    },
  };

  return { active, handlers };
}

/** "Drop files to send" over the area while files are dragged over it. */
export function DropOverlay({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div
      // pointer-events-none: the overlay must not become the drag target itself,
      // or every move over it would count as leaving the area underneath.
      className="pointer-events-none absolute inset-0 z-30 grid place-items-center rounded-[inherit] border-2 border-dashed border-blue-500 bg-blue-50/85"
      data-testid="drop-overlay"
      aria-hidden="true"
    >
      <span className="flex flex-col items-center gap-2 text-blue-800">
        <Upload className="h-8 w-8" />
        <span className="text-base font-semibold">Drop files to send</span>
        <span className="text-xs text-blue-700">Photos, videos, PDFs and documents</span>
      </span>
    </div>
  );
}
