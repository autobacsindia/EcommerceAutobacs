/**
 * Character limits on typed text — one rule for every box.
 *
 * A box must never cut text off on its own (the browser's `maxLength` silently
 * drops whatever is pasted past the limit). Instead the box takes everything,
 * shows a counter as the limit gets close, and says plainly when it is over —
 * and the save button refuses until the text fits. The server enforces the same
 * number, so this is only ever about telling the person early.
 */

/** Show the counter once the text reaches this share of the limit. */
export const NEAR_LIMIT_SHARE = 0.8;

export const formatCount = (n: number): string => n.toLocaleString('en-IN');

export type TextLimitStatus = { over: boolean; near: boolean; message: string };

export function textLimitStatus(length: number, max: number): TextLimitStatus {
  const over = length > max;
  const near = !over && length >= Math.floor(max * NEAR_LIMIT_SHARE);
  const message = over
    ? `Too long by ${formatCount(length - max)} character${length - max === 1 ? '' : 's'} (the limit is ${formatCount(max)}). Please shorten it or split it into two.`
    : near
      ? `${formatCount(length)} / ${formatCount(max)} characters`
      : '';
  return { over, near, message };
}

/** True when text is too long to save — use it to disable the save/send button. */
export const isOverLimit = (text: string | null | undefined, max: number): boolean => (text ?? '').length > max;
