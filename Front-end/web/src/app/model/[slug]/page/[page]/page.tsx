import { Metadata } from 'next';
import { redirect } from 'next/navigation';
import VehicleModelListing from '@/components/vehicles/VehicleModelListing';
import { buildVehicleMetadata } from '@/lib/vehicleMetadata';

function parsePage(raw: string): number {
  return Math.max(1, parseInt(raw, 10) || 1);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; page: string }>;
}): Promise<Metadata> {
  const { slug, page } = await params;
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
  if (pageNumber <= 1) redirect(`/model/${slug}`);
  return <VehicleModelListing slug={slug} pageNumber={pageNumber} />;
}
