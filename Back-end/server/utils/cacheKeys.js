/**
 * Cache-key helpers shared by cacheMiddleware (`route:`) and
 * publicCacheMiddleware (`public:`).
 *
 * Both middlewares hash the request into an opaque key. A bare hash is
 * un-invalidatable: `invalidateCache('categories')` globs `*categories*`, which
 * can never match `route:4ffc7a8e…`. Embedding the resource namespace in the
 * key makes those existing invalidation calls actually hit.
 */

/** Resource segment of an API path: `/api/v1/products/:id/similar` → `products`. */
export const routeNamespace = (originalUrl = '') => {
  const path = String(originalUrl).split('?')[0];

  // Drop the version prefix so the namespace is the resource, not `api`.
  const withoutVersion = path.replace(/^\/api\/v\d+\//i, '/');

  const segment = withoutVersion.split('/').filter(Boolean)[0] || 'misc';

  // Keep keys glob-safe and bounded: Redis SCAN patterns treat `*`/`?`/`[` as
  // wildcards, and a hostile path shouldn't be able to widen an invalidation.
  const safe = segment.toLowerCase().replace(/[^a-z0-9-]/g, '');

  return safe.slice(0, 32) || 'misc';
};
