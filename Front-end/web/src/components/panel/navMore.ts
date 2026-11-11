/**
 * Splits a panel menu into the links people use every day and the ones that
 * fold under "More". One rule for every panel: the caller names the hrefs that
 * belong under "More"; everything else stays visible, in its original order.
 *
 * Runs AFTER the caller has decided who may see what, so it never adds or
 * removes a link — only moves it. A panel whose "More" list ends up empty gets
 * no "More" button at all (PanelShell hides an empty one).
 */
export function splitMore<T extends { href: string }>(
  items: readonly T[],
  moreHrefs: Iterable<string>,
): { items: T[]; more: T[] } {
  const wanted = new Set(moreHrefs);
  const visible: T[] = [];
  const more: T[] = [];
  for (const item of items) (wanted.has(item.href) ? more : visible).push(item);
  return { items: visible, more };
}

/** Badge for a closed "More": the unread counts of everything hidden under it. */
export const moreCount = (items: readonly { count?: number }[]) =>
  items.reduce((sum, { count }) => sum + (count && count > 0 ? count : 0), 0);
