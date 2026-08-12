/**
 * Product gallery composition — shared by the admin write path and maintenance
 * scripts so "what a valid gallery looks like" has exactly one definition.
 *
 * The rules that matter downstream:
 *   - An image is identified by its KEY: its Cloudinary public_id, or its URL
 *     for migrated rows that never got one. Ordering, primary selection and
 *     removal all match on the key, so legacy images behave like any other.
 *   - A non-empty gallery always has exactly one `isPrimary`. An all-false
 *     gallery renders no thumbnail in listings, feeds or search results.
 */

/**
 * Stable identity for a gallery entry. Cloudinary assets are keyed by public_id;
 * legacy/migrated images that never got one fall back to their URL so they can
 * still be ordered, chosen as primary, and removed.
 */
export const imageKey = (img) => img?.public_id || img?.url || '';

/**
 * Apply a sequencing intent to a composed gallery.
 *
 * `order` is the list of image keys in display order, and `primaryKey` names the
 * thumbnail. Both are advisory: an entry the order omits is APPENDED rather than
 * dropped, because a stale or partial order arriving from a racing tab must
 * never silently delete an image. Removal is a separate, explicit channel.
 *
 * Mutates and returns the pool entries (callers pass freshly-built plain
 * objects, never live Mongoose subdocuments).
 *
 * @param {{url:string, public_id?:string, alt?:string, isPrimary?:boolean}[]} pool
 * @param {string[]|null} order
 * @param {string|null} primaryKey
 */
export const orderGallery = (pool, order, primaryKey) => {
  let ordered = pool;

  if (Array.isArray(order) && order.length) {
    const byKey = new Map();
    pool.forEach((img) => {
      const key = imageKey(img);
      if (key && !byKey.has(key)) byKey.set(key, img);
    });

    const picked = [];
    const seen = new Set();
    for (const key of order) {
      const img = byKey.get(key);
      if (img && !seen.has(key)) {
        picked.push(img);
        seen.add(key);
      }
    }
    ordered = [...picked, ...pool.filter((img) => !seen.has(imageKey(img)))];
  }

  ordered.forEach((img) => { img.isPrimary = false; });
  if (ordered.length) {
    const chosen = primaryKey
      ? ordered.find((img) => imageKey(img) === primaryKey)
      : null;
    (chosen || ordered[0]).isPrimary = true;
  }
  return ordered;
};

/**
 * Decide what a product's gallery should become once the images whose assets no
 * longer exist are dropped.
 *
 * Pure and side-effect free so the sweep's decision can be tested without
 * touching Cloudinary or Mongo — the risky part of that script is this
 * judgement, not the I/O around it.
 *
 * `isAlive(img)` returns false ONLY for an image positively confirmed missing.
 * Anything unverified must come back true, so an API hiccup can never be read
 * as "this asset is gone" and delete a live image's row.
 *
 * @param {{images?: object[]}} product
 * @param {(img: object) => boolean} isAlive
 * @returns {{ dead: object[], survivors: object[], changed: boolean, emptied: boolean }}
 */
export const planGalleryCleanup = (product, isAlive) => {
  const images = Array.isArray(product?.images) ? product.images : [];
  const dead = images.filter((img) => !isAlive(img));

  if (dead.length === 0) {
    return { dead: [], survivors: images, changed: false, emptied: false };
  }

  const deadKeys = new Set(dead.map(imageKey));
  const kept = images
    .filter((img) => !deadKeys.has(imageKey(img)))
    .map((img) => ({
      url:       img.url,
      public_id: img.public_id,
      alt:       img.alt,
      isPrimary: img.isPrimary,
    }));

  // Preserve the surviving order, and keep the admin's chosen thumbnail unless
  // that was one of the dead images — then the first survivor is promoted.
  const previousPrimary = images.find((img) => img.isPrimary);
  const primaryKey = previousPrimary && !deadKeys.has(imageKey(previousPrimary))
    ? imageKey(previousPrimary)
    : null;

  return {
    dead,
    survivors: orderGallery(kept, null, primaryKey),
    changed:   true,
    emptied:   kept.length === 0,
  };
};
