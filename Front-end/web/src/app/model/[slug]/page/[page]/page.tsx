import { Metadata } from 'next';
import { notFound, permanentRedirect, redirect } from 'next/navigation';
import VehicleModelListing from '@/components/vehicles/VehicleModelListing';
import { buildVehicleMetadata, lookupVehicle, vehiclePageCount } from '@/lib/vehicleMetadata';
import { resolveLegacyTarget } from '@/lib/legacyTargetServer';

// Same rule as /model/[slug]: a slug the API confirms does not exist (a
// WooCommerce-era tag archive) goes to the vehicle/product it names, else 404s.
async function resolveOrLeave(slug: string) {
  const result = await lookupVehicle(slug);
  if (result.status === 'missing') {
    // A WooCommerce tag archive: to the vehicle it names (or a product), else 404 —
    // never to /products/search, which is noindex.
    const target = await resolveLegacyTarget(slug, 'model');
    if (target && target !== `/model/${slug}`) permanentRedirect(target);
    notFound();
  }
  if (result.status !== 'found') notFound();
}

function parsePage(raw: string): number {
  return Math.max(1, parseInt(raw, 10) || 1);
}

/**
 * A page past the vehicle's last one is a 404, not an empty listing answering 200.
 * Only when the count is KNOWN — a failed count renders the page as before.
 * vehiclePageCount is cache()d, so metadata and page share one call.
 */
async function leaveIfPastEnd(slug: string, pageNumber: number) {
  const pages = await vehiclePageCount(slug);
  if (pages !== null && pageNumber > pages) notFound();
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; page: string }>;
}): Promise<Metadata> {
  const { slug, page } = await params;
  // Same soft-404 as /model/[slug]: an unknown slug must not render a listing
  // titled after the slug. See the note there.
  await resolveOrLeave(slug);
  await leaveIfPastEnd(slug, parsePage(page));
  return buildVehicleMetadata(slug, parsePage(page));
}

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string; page: string }>;
}) {
  const { slug, page } = await params;
  const pageNumber = parsePage(page);
  // Page 1 has a canonical home at /model/[slug]; don't serve a duplicate here.
  // Redirect BEFORE the existence check so the canonical URL is the one that
  // 404s — a redirect to a 404 is clearer to a crawler than a 404 on an alias.
  if (pageNumber <= 1) redirect(`/model/${slug}`);
  await resolveOrLeave(slug);
  await leaveIfPastEnd(slug, pageNumber);
  return <VehicleModelListing slug={slug} pageNumber={pageNumber} />;
}
