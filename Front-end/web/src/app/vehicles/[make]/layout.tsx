import { notFound } from 'next/navigation';
import { makeExists } from '@/lib/vehicleExistence';

/**
 * Existence gate for /vehicles/[make].
 *
 * The page itself is a client component: it fetched every vehicle and filtered
 * by make, so an unknown make rendered an empty-but-successful page under HTTP
 * 200 — a soft 404. A client component cannot 404, but this SERVER layout can,
 * and it runs before the page renders, so the check is cheap and the page needs
 * no restructuring.
 *
 * ⚠️ Do NOT add a loading.tsx to this segment or any ancestor: a Suspense
 * boundary above this await commits HTTP 200 before notFound() can throw.
 */
export default async function VehicleMakeLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ make: string }>;
}) {
  const { make } = await params;
  if (!(await makeExists(decodeURIComponent(make)))) notFound();
  return children;
}
