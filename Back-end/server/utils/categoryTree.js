/**
 * Roll distinct active-product ids up the category tree.
 *
 * A parent's count is the UNION of its own products and every descendant's —
 * what "View products" shows, since the search filter expands a category to its
 * whole subtree. Union, not sum, so a product tagged on both a hub and a child
 * counts once (matches SearchService.getFacets and the listing total).
 * O(N) over parent pointers already loaded; cycle-safe.
 *
 * @param {Array<{_id: any, parent?: any}>} categories  parent may be an id or a populated { _id }
 * @param {Array<{_id: any, ids: any[]}>} grouped       productRepository.distinctActiveIdsByCategory()
 * @returns {{ direct: (id: string) => number, total: (id: string) => number }}
 */
export function categoryProductCounts(categories, grouped) {
  const directIds = new Map(grouped.map((c) => [String(c._id), new Set(c.ids.map(String))]));

  const childrenOf = new Map();
  for (const c of categories) {
    const parentId = c.parent?._id ? String(c.parent._id) : (c.parent ? String(c.parent) : null);
    if (!parentId) continue;
    if (!childrenOf.has(parentId)) childrenOf.set(parentId, []);
    childrenOf.get(parentId).push(String(c._id));
  }

  const memo = new Map();
  const inProgress = new Set();
  const subtreeIds = (id) => {
    if (memo.has(id)) return memo.get(id);
    if (inProgress.has(id)) return new Set(); // guard against any pre-existing cycle
    inProgress.add(id);
    const union = new Set(directIds.get(id) || []);
    for (const childId of (childrenOf.get(id) || [])) {
      for (const pid of subtreeIds(childId)) union.add(pid);
    }
    inProgress.delete(id);
    memo.set(id, union);
    return union;
  };

  return {
    direct: (id) => directIds.get(String(id))?.size || 0,
    total: (id) => subtreeIds(String(id)).size,
  };
}
