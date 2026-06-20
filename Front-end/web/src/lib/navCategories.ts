import { serverFetch } from '@/lib/server-api';

export interface NavCategory {
  label: string;
  href: string;
}

interface ApiCategory {
  _id?: string;
  name?: string;
  slug?: string;
  isActive?: boolean;
}

/**
 * Curated header set. Labels are the familiar nav labels; `aliases` let us match
 * the live category regardless of which slug/name convention it was stored under
 * (the data has drifted across `bodykit`/`body-kits`, `audio`/`speaker`,
 * `lights`/`lighting`). We then link using the category's REAL slug, so the nav
 * no longer depends on the backend slug-translation hacks.
 */
const CURATED_NAV: { label: string; aliases: string[] }[] = [
  { label: 'Accessories', aliases: ['accessories'] },
  { label: 'Exterior',    aliases: ['exterior'] },
  { label: 'Interior',    aliases: ['interior'] },
  { label: 'Body Kits',   aliases: ['body-kits', 'bodykit', 'body-kit', 'bodykits'] },
  { label: 'Performance', aliases: ['performance'] },
  { label: 'Suspension',  aliases: ['suspension'] },
  { label: 'Audio',       aliases: ['audio', 'speaker', 'speakers', 'sound-system', 'sound'] },
  { label: 'Lights',      aliases: ['lights', 'lighting', 'light'] },
];

/**
 * Static fallback used only if the categories API is unreachable, so the nav
 * never disappears. Hrefs use the legacy slugs that the backend still resolves.
 */
export const FALLBACK_NAV_CATEGORIES: NavCategory[] = [
  { label: 'Accessories', href: '/categories/accessories' },
  { label: 'Exterior',    href: '/categories/exterior' },
  { label: 'Interior',    href: '/categories/interior' },
  { label: 'Body Kits',   href: '/categories/bodykit' },
  { label: 'Performance', href: '/categories/performance' },
  { label: 'Suspension',  href: '/categories/suspension' },
  { label: 'Audio',       href: '/categories/audio' },
  { label: 'Lights',      href: '/categories/lights' },
];

const normalize = (s: string) =>
  (s || '')
    .toLowerCase()
    .trim()
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9-]/g, '');

/**
 * Resolve the curated header set against the live categories, linking each to
 * its real slug. Items with no matching active category are dropped so the nav
 * never renders a broken link. Exported for unit testing.
 */
export function resolveNavCategories(categories: ApiCategory[]): NavCategory[] {
  const bySlug = new Map<string, ApiCategory>();
  const byName = new Map<string, ApiCategory>();
  for (const c of categories || []) {
    if (c?.isActive === false) continue;
    if (c?.slug) bySlug.set(normalize(c.slug), c);
    if (c?.name) byName.set(normalize(c.name), c);
  }

  const result: NavCategory[] = [];
  for (const item of CURATED_NAV) {
    let match: ApiCategory | undefined;
    for (const alias of item.aliases) {
      const key = normalize(alias);
      match = bySlug.get(key) || byName.get(key);
      if (match) break;
    }
    if (match?.slug) {
      result.push({ label: item.label, href: `/categories/${match.slug}` });
    }
  }
  return result;
}

/**
 * Server-side: fetch active categories and resolve the curated header nav.
 * Cached for 10 minutes (categories change rarely). Falls back to a static list
 * if the API is unavailable or returns nothing usable.
 */
export async function getNavCategories(): Promise<NavCategory[]> {
  try {
    const data = await serverFetch<{ categories?: ApiCategory[] }>(
      '/categories?limit=200',
      { next: { revalidate: 600 } }
    );
    const resolved = resolveNavCategories(data?.categories ?? []);
    return resolved.length > 0 ? resolved : FALLBACK_NAV_CATEGORIES;
  } catch {
    return FALLBACK_NAV_CATEGORIES;
  }
}
