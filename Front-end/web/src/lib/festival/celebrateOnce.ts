/**
 * "Fireworks once per order": claims the celebration for `orderId` in this tab.
 * Returns true exactly once; a refresh or a second mount returns false.
 *
 * Storage unavailable (private mode, blocked) → false: skipping the fireworks is
 * harmless, replaying them on every refresh is not.
 */
const keyFor = (orderId: string) => `festival_celebrated_${orderId}`;

export function claimOrderCelebration(orderId: string): boolean {
  if (!orderId) return false;
  try {
    if (sessionStorage.getItem(keyFor(orderId))) return false;
    sessionStorage.setItem(keyFor(orderId), '1');
    return true;
  } catch {
    return false;
  }
}
