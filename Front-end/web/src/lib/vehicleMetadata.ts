import type { Metadata } from 'next';
import { cache } from 'react';
import { getVehicleImageUrl } from '@/services/vehicleService';
import { getServerApiBase } from '@/lib/server-api';
import { VEHICLE_PAGE_SIZE } from '@/lib/vehiclePaging';

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

/**
 * cache()d so generateMetadata and the page body resolve the same slug with ONE
 * upstream call. Exported because the route files need the null answer too: a
 * slug with no Vehicle must 404, not render a listing titled after the slug.
 */
export type VehicleLookup =
  | { status: 'found'; vehicle: VehicleMeta }
  | { status: 'missing' }
  | { status: 'error' };

/**
 * Like fetchVehicle, but keeps "no such vehicle" (the API answered 404) apart from
 * "the lookup failed". Only the former may send a legacy /model/<tag> URL on to a
 * permanent search redirect — redirecting on an outage would permanently cache a
 * redirect away from a real vehicle page.
 */
export const lookupVehicle = cache(async function lookupVehicle(slug: string): Promise<VehicleLookup> {
  try {
    const res = await fetch(`${getServerApiBase()}/vehicles/slug/${slug}`, {
      next: { revalidate: 3600 },
    });
    if (res.status === 404) return { status: 'missing' };
    if (!res.ok) return { status: 'error' };
    const data = await res.json();
    return data?.success && data.vehicle
      ? { status: 'found', vehicle: data.vehicle as VehicleMeta }
      : { status: 'missing' };
  } catch (error) {
    console.error('Vehicle metadata fetch error:', error);
    return { status: 'error' };
  }
});

/**
 * How many listing pages a vehicle has, or null when the count could not be read.
 *
 * Lets /model/[slug]/page/[n] 404 past the last page: an empty page answered 200
 * with a self-canonical, which Google files as a thin page (Search Console held
 * WooCommerce-era page numbers far past today's catalogue). Counts the UNFILTERED
 * listing, so a page that exists without a ?category= filter is never 404ed.
 *
 * Null on any failure — an outage must never turn a real page into a 404. A short
 * revalidate keeps a newly-added last page from 404ing for long; limit=1 because
 * only `total` is needed.
 */
export const vehiclePageCount = cache(async function vehiclePageCount(slug: string): Promise<number | null> {
  try {
    const res = await fetch(
      `${getServerApiBase()}/products/by-vehicle/${encodeURIComponent(slug)}?page=1&limit=1`,
      { next: { revalidate: 600 } },
    );
    if (!res.ok) return null;
    const total = Number((await res.json())?.total);
    return Number.isFinite(total) && total >= 0 ? Math.ceil(total / VEHICLE_PAGE_SIZE) : null;
  } catch (error) {
    console.error('Vehicle page count fetch error:', error);
    return null;
  }
});

export const fetchVehicle = cache(async function fetchVehicle(slug: string): Promise<VehicleMeta | null> {
  const result = await lookupVehicle(slug);
  return result.status === 'found' ? result.vehicle : null;
});

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
    // Only a photo that exists — a guessed path gave 49 vehicles a broken share
    // image. With none, the site's default share image (same as the root layout's);
    // an empty list would drop it, since openGraph replaces the parent object.
    images.push(getVehicleImageUrl(slug) ?? '/og-image.jpg');
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
