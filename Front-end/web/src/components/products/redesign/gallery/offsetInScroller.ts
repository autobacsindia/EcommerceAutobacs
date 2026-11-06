/**
 * Horizontal position of `child` inside its scroll container, in the
 * container's scroll coordinates (i.e. the `left` to pass to `scrollTo`).
 *
 * Why not just `child.offsetLeft`: `offsetLeft` is measured from the nearest
 * POSITIONED ancestor, not from the parent. The gallery's scrollers are not
 * positioned, so `offsetLeft` silently includes how far the scroller itself sits
 * from that ancestor. In the fullscreen viewer the thumbnail rail is centred
 * (`mx-auto max-w-md`) inside a fixed `<dialog>`, ~288px from its left edge on a
 * laptop — so every target came out 288px too far right, the rail scrolled to
 * its end, and thumbnails 1–2 (the parts photo on the Thar ROXX storage box)
 * were pushed out of view whenever the viewer opened near the start.
 *
 * Subtracting the scroller's own offset (both share the same offset parent when
 * the scroller is unpositioned) makes the result independent of where the
 * scroller is placed on the page.
 */
export function offsetInScroller(child: HTMLElement, scroller: HTMLElement): number {
  if (child.offsetParent === scroller) return child.offsetLeft;
  return child.offsetLeft - scroller.offsetLeft - (scroller.clientLeft || 0);
}
