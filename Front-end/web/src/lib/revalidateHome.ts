/**
 * Fire-and-forget on-demand refresh of the home page's cached sections after an
 * admin data change, so `/` reflects the change within seconds instead of waiting
 * out the ISR window (revalidate = 300s). Hits the same-origin
 * `/api/revalidate/home` route (see app/api/revalidate/home/route.ts), which calls
 * `revalidateTag` for the given section.
 *
 * Best-effort: never blocks the caller and never throws — if the refresh fails,
 * the ISR window still catches up on its own.
 */
export type HomeTag =
  | 'home:categories'
  | 'home:products'
  | 'home:testimonials'
  | 'home:journal'
  | 'home:brands';

export async function revalidateHome(tag?: HomeTag): Promise<void> {
  try {
    const qs = tag ? `?tag=${encodeURIComponent(tag)}` : '';
    await fetch(`/api/revalidate/home${qs}`, { method: 'POST' });
  } catch {
    // non-fatal — the ISR revalidate window will refresh the section eventually
  }
}
