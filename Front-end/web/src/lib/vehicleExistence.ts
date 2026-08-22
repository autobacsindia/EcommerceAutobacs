import { cache } from 'react';
import { getServerApiBase, internalApiHeaders } from '@/lib/server-api';

/**
 * Server-side existence checks for the /vehicles/* routes.
 *
 * Both pages under /vehicles are client components that fetch-and-filter, so an
 * unknown make or model produced an empty page under HTTP 200 (a soft 404).
 * These helpers back the server layouts that turn those into real 404s.
 *
 * cache()d per request: a /vehicles/[make]/[model] request runs both layouts,
 * and makeExists() would otherwise refetch the makes list for each.
 */

/**
 * Case-insensitive make lookup.
 *
 * Deliberately uses /vehicles/makes (the distinct list) rather than
 * /vehicles/models/:make, because that endpoint matches `make` EXACTLY — a URL
 * carrying different casing than the stored value would come back empty and we
 * would 404 a real make.
 */
export const makeExists = cache(async (make: string): Promise<boolean> => {
  const wanted = make.trim().toLowerCase();
  if (!wanted) return false;
  try {
    const res = await fetch(`${getServerApiBase()}/vehicles/makes`, {
      headers: internalApiHeaders(),
      // Time-based only, deliberately UNTAGGED — there is no `vehicles:` prefix
      // in the revalidator allowlist (src/lib/revalidateTags.ts) and no producer
      // in Back-end/server/utils/nextTags.js, so a tag here would be dropped
      // silently at both ends and read as wired when it is not. An hour of
      // staleness on "does this make exist" is harmless: the worst case is a
      // brand-new make 404ing for up to an hour after an admin adds it.
      next: { revalidate: 3600 },
    });
    if (!res.ok) return true; // fail OPEN — see note below
    const data = await res.json();
    const makes: string[] = Array.isArray(data?.makes) ? data.makes : [];
    return makes.some((m) => String(m).trim().toLowerCase() === wanted);
  } catch {
    return true; // fail OPEN — see note below
  }
});

/**
 * Case-insensitive make+model lookup. The backend endpoint already matches both
 * fields case-insensitively and answers 404 when the pair does not exist.
 */
export const vehicleExists = cache(async (make: string, model: string): Promise<boolean> => {
  if (!make.trim() || !model.trim()) return false;
  try {
    const res = await fetch(
      `${getServerApiBase()}/vehicles/make-model/${encodeURIComponent(make)}/${encodeURIComponent(model)}`,
      { headers: internalApiHeaders(), next: { revalidate: 3600 } },
    );
    if (res.status === 404) return false;
    if (!res.ok) return true; // fail OPEN — see note below
    const data = await res.json();
    return Boolean(data?.success && data.vehicle);
  } catch {
    return true; // fail OPEN — see note below
  }
});

/*
 * Why these fail OPEN (treat "cannot tell" as "exists"):
 *
 * A 404 is not recoverable from the visitor's side and Google drops the URL from
 * its index. If the backend is down or rate-limiting SSR, answering 404 would
 * de-index the whole vehicle section over a transient outage. Rendering the page
 * — which then shows its own client-side error or empty state — is the cheaper
 * mistake, and it is temporary. Only a definitive negative from the API 404s.
 */
