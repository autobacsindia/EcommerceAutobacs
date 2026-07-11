import type { Metadata } from 'next';
import { VEHICLE_IMAGE_MAP } from '@/services/vehicleService';
import { getServerApiBase } from '@/lib/server-api';

/**
 * Shared SEO metadata for the `/model/[slug]` routes (page 1 and paginated).
 * Kept in one place so both route files stay thin and can't drift apart.
 */

interface VehicleMeta {
  name?: string;
  make?: string;
  model?: string;
  image?: string | { url?: string };
}

async function fetchVehicle(slug: string): Promise<VehicleMeta | null> {
  try {
    const res = await fetch(`${getServerApiBase()}/vehicles/slug/${slug}`, {
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.success && data.vehicle ? (data.vehicle as VehicleMeta) : null;
  } catch (error) {
    console.error('Vehicle metadata fetch error:', error);
    return null;
  }
}

export async function buildVehicleMetadata(slug: string, page = 1): Promise<Metadata> {
  const vehicle = await fetchVehicle(slug);

  const vehicleName = vehicle
    ? vehicle.name || `${vehicle.make ?? ''} ${vehicle.model ?? ''}`.trim()
    : slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  // The root layout applies a `%s | Autobacs India` title template, so the
  // brand suffix is intentionally omitted here to avoid doubling it.
  const pageSuffix = page > 1 ? ` – Page ${page}` : '';
  const title = `${vehicleName} Accessories${pageSuffix}`;
  const description = `Shop premium accessories, body kits, and parts for ${vehicleName} at Autobacs India. Best prices and wide selection.`;

  const images: string[] = [];
  if (vehicle?.image) {
    images.push(typeof vehicle.image === 'string' ? vehicle.image : vehicle.image.url ?? '');
  }
  if (images.filter(Boolean).length === 0) {
    images.length = 0;
    images.push(VEHICLE_IMAGE_MAP[slug] ?? `/images/vehicles/${slug}.jpg`);
  }

  // Each paginated URL self-canonicalises so deep pages are indexable without
  // duplicating page 1 (rel=next/prev is deprecated by Google).
  const canonical = page > 1 ? `/model/${slug}/page/${page}` : `/model/${slug}`;

  // OG/Twitter titles bypass the layout template, so add the brand explicitly.
  const socialTitle = `${title} | Autobacs India`;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title: socialTitle, description, images, type: 'website' },
    twitter: { card: 'summary_large_image', title: socialTitle, description, images },
  };
}
