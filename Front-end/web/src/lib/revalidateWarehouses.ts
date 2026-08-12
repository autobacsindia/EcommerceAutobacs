/**
 * Fire-and-forget refresh of the homepage's Delivery Network section after a
 * warehouse write. Hits the same-origin /api/revalidate/warehouses route, which
 * calls revalidateTag('warehouses').
 *
 * That section is fetched with `revalidate: 3600`, so without this an admin's
 * edit to a warehouse shown on the homepage stayed invisible for up to an hour.
 * Only the homepage-visibility toggle used to call it — create, edit and delete
 * did not.
 *
 * Best-effort: never blocks the caller and never throws — the ISR window still
 * catches up on its own.
 */
export async function revalidateWarehouses(): Promise<void> {
  try {
    await fetch('/api/revalidate/warehouses', { method: 'POST' });
  } catch {
    // non-fatal — the 1h revalidate window will refresh the section eventually
  }
}
