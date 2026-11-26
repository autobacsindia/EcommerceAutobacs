import { textLimitStatus } from '@/lib/textLimit';

/**
 * The line under a text box: nothing while there is plenty of room, a quiet
 * counter near the limit, and a clear red message once it is over.
 * Pair it with `isOverLimit` on the save button — and do NOT put `maxLength`
 * on the box, which would cut pasted text off without a word.
 */
export function TextLimitNote({ value, max, className = '' }: { value: string; max: number; className?: string }) {
  const { over, message } = textLimitStatus(value.length, max);
  if (!message) return null;
  return (
    <p
      role={over ? 'alert' : undefined}
      aria-live="polite"
      className={`mt-1 text-xs ${over ? 'font-medium text-red-600' : 'text-gray-500'} ${className}`}
    >
      {message}
    </p>
  );
}
