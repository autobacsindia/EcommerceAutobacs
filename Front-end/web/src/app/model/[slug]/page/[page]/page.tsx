import { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import VehicleModelListing from '@/components/vehicles/VehicleModelListing';
import { buildVehicleMetadata, fetchVehicle } from '@/lib/vehicleMetadata';

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
  if (!(await fetchVehicle(slug))) notFound();
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
  if (!(await fetchVehicle(slug))) notFound();
  return <VehicleModelListing slug={slug} pageNumber={pageNumber} />;
}
