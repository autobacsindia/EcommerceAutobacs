import { Metadata } from 'next';
import VehicleModelListing from '@/components/vehicles/VehicleModelListing';
import { buildVehicleMetadata } from '@/lib/vehicleMetadata';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return buildVehicleMetadata(slug, 1);
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <VehicleModelListing slug={slug} pageNumber={1} />;
}
