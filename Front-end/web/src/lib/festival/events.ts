/**
 * Cart → festival effects bridge. CartContext announces an add; the lazily
 * loaded effects listen. A fire-and-forget DOM event, so the cart never waits
 * on, imports, or can be broken by animation code.
 */

export const CART_ADD_INTENT_EVENT = 'festival:cart-add-intent';

export function emitCartAddIntent(): void {
  try {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(CART_ADD_INTENT_EVENT));
  } catch {
    /* decoration only — never let this throw into the cart */
  }
}
