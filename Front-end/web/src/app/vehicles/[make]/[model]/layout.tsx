import { notFound } from 'next/navigation';
import { vehicleExists } from '@/lib/vehicleExistence';

/**
 * Existence gate for /vehicles/[make]/[model] — same reasoning as the parent
 * segment's layout. The parent has already proved the MAKE exists; this proves
 * the make+model pair does, so /vehicles/toyota/not-a-real-model 404s instead of
 * rendering an empty listing under HTTP 200.
 */
export default async function VehicleModelLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ make: string; model: string }>;
}) {
  const { make, model } = await params;
  if (!(await vehicleExists(decodeURIComponent(make), decodeURIComponent(model)))) notFound();
  return children;
}
