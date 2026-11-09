/**
 * The path segment for looking an article up through the API.
 *
 * Articles migrated from WordPress keep its percent-encoded slug as literal text
 * (e.g. "%f0%9f%9a%97-how-to-…"), and the route param arrives in that same form.
 * Express decodes the path once, so the slug must be encoded once more or the
 * lookup searches for the decoded emoji and 404s. Lowercased first because stored
 * slugs are lowercase, while a browser sends a pasted emoji as %F0%9F%9A%97.
 */
export const articleSlugForApi = (slug: string): string => encodeURIComponent(slug.toLowerCase());
