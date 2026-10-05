import { Metadata } from 'next';
import { notFound, permanentRedirect, redirect } from 'next/navigation';
import VehicleModelListing from '@/components/vehicles/VehicleModelListing';
import { buildVehicleMetadata, lookupVehicle } from '@/lib/vehicleMetadata';
import { legacySearchPath } from '@/lib/legacySearchRedirect';

// Same rule as /model/[slug]: a slug the API confirms does not exist (a
// WooCommerce-era tag archive) goes to a product search; a failed lookup 404s.
async function resolveOrLeave(slug: string) {
  const result = await lookupVehicle(slug);
  if (result.status === 'missing') permanentRedirect(legacySearchPath(slug));
  if (result.status !== 'found') notFound();
}

function parsePage(raw: string): number {
  return Math.max(1, parseInt(raw, 10) || 1);
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
  return <VehicleModelListing slug={slug} pageNumber={pageNumber} />;
}
