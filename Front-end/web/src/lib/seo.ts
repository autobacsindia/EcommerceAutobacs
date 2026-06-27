import type { Metadata } from 'next';

/**
 * Centralised SEO resolution. Every page that has an editable `seo` override
 * (products today; blog/category/pages next) runs its values through here so
 * the precedence is identical everywhere:
 *
 *   admin override  →  computed default (from the entity)  →  site default
 *
 * Pages spread the result into their own Metadata and layer page-specific
 * extras on top (og:price for products, article authors for blog, etc.).
 */

/** Shape of the embedded `seo` sub-document as it arrives from the API. */
export interface SeoOverrides {
  metaTitle?: string | null;
  metaDescription?: string | null;
  canonical?: string | null;
  ogImage?: string | null;
  noindex?: boolean | null;
}

export interface SeoDefaults {
  /**
   * Computed default title WITHOUT the site suffix. The root layout's
   * "%s | Autobacs India" template appends the suffix for plain-string titles.
   */
  title: string;
  description: string;
  /** Self URL — used as the canonical when no override is set. */
  url: string;
  /** Default OG/social image when no override is set. */
  image?: string | null;
}

export interface ResolvedSeo {
  /**
   * Spread into Metadata.title. A plain string lets the layout's title template
   * append the site suffix; `{ absolute }` opts out (admin supplied a full title).
   * Both forms are assignable to Metadata['title'].
   */
  title: string | { absolute: string };
  description: string;
  canonical: string;
  ogImage?: string;
  robots?: Metadata['robots'];
}

// Hard caps mirror the backend SeoSchema / admin SeoPanel limits.
const TITLE_CAP = 70;
const DESC_CAP = 200;

const firstNonEmpty = (...vals: Array<string | null | undefined>): string =>
  vals.find((v) => typeof v === 'string' && v.trim().length > 0)?.trim() ?? '';

const clamp = (s: string, max: number): string =>
  s.length > max ? s.slice(0, max).trimEnd() : s;

export function resolveSeo(overrides: SeoOverrides | null | undefined, defaults: SeoDefaults): ResolvedSeo {
  const o = overrides ?? {};

  // Title: when the admin supplies a full meta title, use { absolute } so the
  // layout template does NOT append " | Autobacs India" a second time. When we
  // fall back to the computed default, return a plain string so the template
  // appends the site suffix as usual.
  const overrideTitle = firstNonEmpty(o.metaTitle);
  const title: ResolvedSeo['title'] = overrideTitle
    ? { absolute: clamp(overrideTitle, TITLE_CAP) }
    : defaults.title;

  const description = clamp(firstNonEmpty(o.metaDescription, defaults.description), DESC_CAP);
  const canonical = firstNonEmpty(o.canonical, defaults.url);
  const ogImage = firstNonEmpty(o.ogImage, defaults.image) || undefined;

  // noindex => keep it out of the index but still allow link-following so
  // equity flows through to linked pages.
  const robots: Metadata['robots'] | undefined = o.noindex
    ? { index: false, follow: true }
    : undefined;

  return { title, description, canonical, ogImage, robots };
}
