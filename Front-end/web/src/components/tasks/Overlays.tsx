'use client';

import { useEffect, useState, type ReactNode } from 'react';

/*
  Plain CSS transitions, not an animation library: framer-motion added 57 KB to
  the Tasks page's first load (213 → 270 KB on /team/tasks, measured with
  `next build`) for one slide and one fade. Nothing else in the panel loads it.

  The backdrops use a literal rgb(), not `bg-black`/`bg-gray-900`: the dark
  theme re-maps those ramps to light values (globals.css), which would turn a
  dimmed page into a light wash.
*/

const DURATION_MS = 200;

/**
 * Keeps an overlay in the page for the length of its closing transition, and
 * flips `shown` one frame after mounting so the opening transition runs.
 */
function useTransition(open: boolean) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (open) {
      setMounted(true);
      const frame = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(frame);
    }
    setShown(false);
    const timer = setTimeout(() => setMounted(false), DURATION_MS);
    return () => clearTimeout(timer);
  }, [open]);
  return { mounted, shown };
}

/**
 * Close on Escape, and keep the page behind from scrolling while open. An
 * Escape something inside already used (cancelling a field being edited, a
 * picker) says so with preventDefault, and leaves the overlay open.
 */
function useOverlay(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) onClose(); };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [open, onClose]);
}

const fade = 'transition-opacity duration-200 ease-out motion-reduce:transition-none';

/** A centred window over a dimmed page (the new-task form). */
export function Dialog({ open, onClose, label, children }: { open: boolean; onClose: () => void; label: string; children: ReactNode }) {
  useOverlay(open, onClose);
  const { mounted, shown } = useTransition(open);
  if (!mounted) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-3 pt-[8vh] sm:p-6 sm:pt-[10vh]">
      <div className={`absolute inset-0 bg-[rgb(0_0_0/0.45)] ${fade} ${shown ? 'opacity-100' : 'opacity-0'}`} onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={`relative w-full max-w-xl transition duration-150 ease-out motion-reduce:transition-none ${
          shown ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-3 scale-[0.98] opacity-0'
        }`}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * A task opens in a large window over the list, like ClickUp's task view: the
 * details on the left, the activity on the right (on a wide screen), the list
 * still there underneath. Full screen on a phone. The content scrolls itself.
 */
export function TaskWindow({ open, onClose, label, children }: { open: boolean; onClose: () => void; label: string; children: ReactNode }) {
  useOverlay(open, onClose);
  const { mounted, shown } = useTransition(open);
  if (!mounted) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center sm:items-center sm:p-4 lg:p-6">
      <div className={`absolute inset-0 bg-[rgb(0_0_0/0.45)] ${fade} ${shown ? 'opacity-100' : 'opacity-0'}`} onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={`relative flex w-full max-w-6xl flex-col overflow-hidden bg-white shadow-2xl transition duration-150 ease-out motion-reduce:transition-none sm:h-[min(92vh,960px)] sm:rounded-2xl ${
          shown ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-3 scale-[0.98] opacity-0'
        }`}
      >
        {children}
      </div>
    </div>
  );
}
