'use client';

/**
 * The line between the Home list and the open conversation, as in Google
 * Chat: point at it and it shows a grip and a ↔ cursor; drag to widen or
 * narrow the list. Double-click puts the width back. With the keyboard, Tab to
 * it and use ← → (Shift for bigger steps), Home / End for narrowest / widest,
 * and Enter to hide the lists. Dragging well past the narrowest width hides
 * the lists too — the old "<" button's job.
 */
import { useRef } from 'react';
import { LIST_DEFAULT, LIST_MAX, LIST_MIN, dragHidesList, widthForKey } from './chatLayout';

export default function ListResizeHandle({
  width,
  onResize,
  onCommit,
  onHide,
  onDragging,
}: {
  width: number;
  /** Moves the list while dragging (not saved). */
  onResize: (w: number) => void;
  /** The final width: saved. */
  onCommit: (w: number) => void;
  /** Hide the sections and the list so the conversation fills the area. */
  onHide: () => void;
  /** True while a drag is in progress (transitions are switched off meanwhile). */
  onDragging: (on: boolean) => void;
}) {
  const drag = useRef<{ x: number; w: number; raw: number; id: number } | null>(null);

  const end = (el: HTMLElement) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    try { el.releasePointerCapture(d.id); } catch { /* already released */ }
    onDragging(false);
    if (dragHidesList(d.raw)) {
      // Keep the width it had before the drag for when the lists come back.
      onCommit(d.w);
      onHide();
    } else {
      onCommit(d.raw);
    }
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-controls="gc-home"
      aria-label="Resize the chat list"
      aria-valuemin={LIST_MIN}
      aria-valuemax={LIST_MAX}
      aria-valuenow={width}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      data-testid="gc-resize"
      className="gc-resize absolute inset-y-0 left-1/2 w-3 -translate-x-1/2 cursor-col-resize touch-none select-none"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        drag.current = { x: e.clientX, w: width, raw: width, id: e.pointerId };
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not supported */ }
        onDragging(true);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        d.raw = d.w + (e.clientX - d.x);
        onResize(d.raw);
      }}
      onPointerUp={(e) => end(e.currentTarget)}
      onPointerCancel={(e) => end(e.currentTarget)}
      onLostPointerCapture={(e) => end(e.currentTarget)}
      onDoubleClick={() => onCommit(LIST_DEFAULT)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onHide();
          return;
        }
        const next = widthForKey(width, e.key, e.shiftKey);
        if (next === null) return;
        e.preventDefault();
        onCommit(next);
      }}
    >
      <span className="gc-resize-grip" aria-hidden="true" />
    </div>
  );
}
