import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import VehicleModelListing from '@/components/vehicles/VehicleModelListing';
import { buildVehicleMetadata, fetchVehicle } from '@/lib/vehicleMetadata';

/**
 * An unknown slug used to render a full listing page titled after the slug
 * itself — buildVehicleMetadata falls back to a title-cased slug when the
 * lookup misses — so /model/anything-at-all answered HTTP 200 with a plausible
 * "Anything At All Accessories" page. A soft 404, and an unusually inviting one
 * for a crawler.
 *
 * fetchVehicle is cache()d, so this check and generateMetadata share one call.
 *
 * ⚠️ Do NOT add a loading.tsx to this segment or any ancestor: a Suspense
 * boundary above this await commits HTTP 200 before notFound() can throw.
 */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  if (!(await fetchVehicle(slug))) notFound();
  return buildVehicleMetadata(slug, 1);
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!(await fetchVehicle(slug))) notFound();
  return <VehicleModelListing slug={slug} pageNumber={1} />;
}
