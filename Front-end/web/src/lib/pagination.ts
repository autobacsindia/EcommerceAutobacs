export const PAGE_ELLIPSIS = '…';

/**
 * Compact page list with ellipses for a paginated navigator: always shows the first
 * and last page plus a window of `delta` pages around the current one, collapsing the
 * rest to a single {@link PAGE_ELLIPSIS} token. A lone gap (exactly one hidden page)
 * is expanded rather than replaced by an ellipsis.
 *
 * e.g. getPageNumbers(6, 20) → [1, '…', 4, 5, 6, 7, 8, '…', 20]
 *      getPageNumbers(2, 5)  → [1, 2, 3, 4, 5]
 *
 * Numeric entries are real page numbers; string entries are ellipsis separators.
 */
export function getPageNumbers(currentPage: number, totalPages: number, delta = 2): (number | string)[] {
  const range: number[] = [1];
  for (let i = Math.max(2, currentPage - delta); i <= Math.min(totalPages - 1, currentPage + delta); i++) {
    range.push(i);
  }
  if (totalPages > 1) range.push(totalPages);

  const out: (number | string)[] = [];
  let last = 0;
  for (const page of range) {
    if (page - last === 2) out.push(last + 1);
    else if (page - last !== 1) out.push(PAGE_ELLIPSIS);
    out.push(page);
    last = page;
  }
  return out;
}
