import { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import VehicleModelListing from '@/components/vehicles/VehicleModelListing';
import { buildVehicleMetadata, lookupVehicle } from '@/lib/vehicleMetadata';
import { legacySearchPath } from '@/lib/legacySearchRedirect';

/**
 * An unknown slug used to render a full listing page titled after the slug
 * itself — buildVehicleMetadata falls back to a title-cased slug when the
 * lookup misses — so /model/anything-at-all answered HTTP 200 with a plausible
 * "Anything At All Accessories" page. A soft 404, and an unusually inviting one
 * for a crawler.
 *
 * A slug the API confirms does not exist is almost always a WooCommerce-era
 * product-tag archive (/model/hilux-led-lights): those are sent on to a product
 * search for the same words instead of a dead end. A FAILED lookup still 404s —
 * it must never become a permanent redirect away from a real vehicle.
 *
 * lookupVehicle is cache()d, so this check and generateMetadata share one call.
 *
 * ⚠️ Do NOT add a loading.tsx to this segment or any ancestor: a Suspense
 * boundary above this await commits HTTP 200 before notFound() / the redirect
 * can throw.
 */
async function resolveOrLeave(slug: string) {
  const result = await lookupVehicle(slug);
  if (result.status === 'missing') permanentRedirect(legacySearchPath(slug));
  if (result.status !== 'found') notFound();
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  await resolveOrLeave(slug);
  return buildVehicleMetadata(slug, 1);
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await resolveOrLeave(slug);
  return <VehicleModelListing slug={slug} pageNumber={1} />;
}
