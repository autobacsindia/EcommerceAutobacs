'use client';

import { useEffect, useRef } from 'react';

/** The six that cover most answers, shown first and largest. */
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '🙏', '✅', '👀'] as const;

/**
 * A small, fixed set rather than a full emoji library: a few hundred KB of
 * picker for the handful of emoji a team actually reacts with is not worth it.
 * People on a phone can still use any emoji their keyboard has in a message.
 */
export const MORE_EMOJI = [
  '👍', '👎', '👏', '🙌', '🙏', '💪', '🤝', '👌', '✌️', '👋',
  '❤️', '🔥', '🎉', '✨', '💯', '⭐', '✅', '❌', '⚠️', '❗',
  '❓', '👀', '😀', '😂', '🤣', '😊', '😍', '😎', '🤔', '😅',
  '😮', '😢', '😡', '😴', '🥳', '🤗', '🚚', '📦', '💰', '⏳',
] as const;

/**
 * Pick one emoji. Closes on a pick, on Escape, or on a click anywhere else.
 */
export default function EmojiPicker({
  onPick,
  onClose,
  className = '',
}: {
  onPick: (emoji: string) => void;
  onClose: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey, true);
    // Keyboard users land on the first emoji.
    ref.current?.querySelector('button')?.focus();
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  const pick = (e: string) => { onPick(e); onClose(); };
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Choose an emoji"
      className={`z-30 w-[17rem] rounded-2xl border border-gray-200 bg-white p-2 shadow-xl ${className}`}
    >
      <div className="flex justify-between border-b border-gray-100 pb-1.5">
        {QUICK_REACTIONS.map((e) => (
          <button key={e} type="button" onClick={() => pick(e)} aria-label={e}
            className="grid h-10 w-10 place-items-center rounded-full text-2xl hover:bg-emerald-50 focus:bg-emerald-50 focus:outline-none">
            {e}
          </button>
        ))}
      </div>
      <div className="mt-1.5 grid grid-cols-8 gap-0.5">
        {MORE_EMOJI.map((e) => (
          <button key={e} type="button" onClick={() => pick(e)} aria-label={e}
            className="grid h-8 w-8 place-items-center rounded-lg text-lg hover:bg-emerald-50 focus:bg-emerald-50 focus:outline-none">
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}
