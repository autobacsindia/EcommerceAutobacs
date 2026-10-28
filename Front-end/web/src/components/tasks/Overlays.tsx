'use client';

import { useEffect, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

/*
  The backdrops use a literal rgb(), not `bg-black`/`bg-gray-900`: the dark
  theme re-maps those ramps to light values (globals.css), which would turn a
  dimmed page into a light wash.
*/

/** Close on Escape, and keep the page behind from scrolling while open. */
function useOverlay(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [open, onClose]);
}

/**
 * A task slides in from the right over the list, like ClickUp: the list stays
 * where it was underneath. Full screen on a phone.
 */
export function SidePanel({ open, onClose, label, children }: { open: boolean; onClose: () => void; label: string; children: ReactNode }) {
  useOverlay(open, onClose);
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50">
          <motion.div
            className="absolute inset-0 bg-[rgb(0_0_0/0.35)]"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
            aria-hidden
          />
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label={label}
            className="absolute inset-y-0 right-0 flex w-full max-w-2xl flex-col overflow-y-auto bg-white px-5 py-4 shadow-2xl sm:px-7 sm:py-6"
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
            transition={{ type: 'tween', duration: 0.22, ease: 'easeOut' }}
          >
            {children}
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
}

/** A centred window over a dimmed page (the new-task form). */
export function Dialog({ open, onClose, label, children }: { open: boolean; onClose: () => void; label: string; children: ReactNode }) {
  useOverlay(open, onClose);
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-3 pt-[8vh] sm:p-6 sm:pt-[10vh]">
          <motion.div
            className="absolute inset-0 bg-[rgb(0_0_0/0.45)]"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={label}
            className="relative w-full max-w-xl"
            initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
          >
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
