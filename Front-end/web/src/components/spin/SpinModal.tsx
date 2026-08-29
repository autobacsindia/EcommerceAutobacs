'use client';

import { useEffect, useRef } from 'react';

/**
 * The shell the spin wheel is presented in.
 *
 * Presentation ONLY. It holds no spin state, and SpinSection keeps running whether this
 * is open or shut — that separation is load-bearing: if closing the modal unmounted the
 * state, a customer who dismissed it mid-spin would come back to a component that had
 * forgotten an outcome the server had already committed.
 *
 * ── Rules this obeys, and why ─────────────────────────────────────────────────
 *
 * 1. NEVER TRAPS THE CUSTOMER. Escape, the backdrop and the close control all dismiss
 *    it, and nothing on the page is gated behind dismissing it. This sits on the ORDER
 *    CONFIRMATION page — the receipt is what the customer came for, and a game must
 *    never stand between them and it. A prize is not worth an unclosable dialog.
 *
 * 2. NOTHING IS LOST BY CLOSING IT. The prize is granted server-side before the needle
 *    moves, so dismissing the wheel cannot forfeit a reward. Reopening shows the same
 *    result, and the coupon code is emailed besides.
 *
 * 3. FOCUS IS RETURNED. Focus moves into the dialog on open and back to whatever opened
 *    it on close — otherwise a keyboard user is dropped at the top of the document, and
 *    a screen-reader user is never told the dialog appeared at all.
 *
 * 4. MOTION IS OPTIONAL. The entrance animation is behind `prefers-reduced-motion`,
 *    which is a vestibular accessibility need rather than a taste.
 */

interface Props {
  open: boolean;
  onClose: () => void;
  /** id of the heading inside `children`, so the dialog announces itself by name. */
  labelledBy: string;
  children: React.ReactNode;
  /** Test seam — forces the no-motion rendering without a matchMedia stub. */
  reducedMotionOverride?: boolean;
}

export default function SpinModal({ open, onClose, labelledBy, children, reducedMotionOverride }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    restoreTo.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);

    // Scroll lock. The previous value is restored rather than blanked, so this cannot
    // clobber a lock some other component set — two dialogs closing in sequence must not
    // leave the page permanently unscrollable.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      /*
        Return focus to whatever opened the dialog. Unconditional on purpose: this
        cleanup runs AFTER React has detached the panel, so "is focus still inside the
        dialog?" is already false by the time we could ask, and guarding on it means
        focus is never restored at all. `isConnected` covers the one case where restoring
        would be wrong — the opener itself is gone from the document.
      */
      const opener = restoreTo.current;
      if (opener?.isConnected) opener.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  const reduced = reducedMotionOverride
    ?? (typeof window !== 'undefined'
      && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
    >
      {/* Plain <style>, not styled-jsx: styled-jsx hashes the keyframe name, which would
          silently stop the inline `animation` below from ever matching it. */}
      <style>{`
        @keyframes abSpinPop {
          from { opacity: 0; transform: translateY(14px) scale(0.96); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>

      <button
        type="button"
        aria-label="Dismiss"
        className="absolute inset-0 bg-black/75"
        onClick={onClose}
      />

      <div
        ref={panelRef}
        tabIndex={-1}
        className="relative my-auto w-full max-w-lg outline-none"
        style={reduced ? undefined : { animation: 'abSpinPop 340ms cubic-bezier(0.16,1,0.3,1)' }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 rounded-full bg-black/40 px-2 py-1 text-lg leading-none text-[#9fb3cc] hover:text-white"
        >
          ×
        </button>
        {children}
      </div>
    </div>
  );
}
