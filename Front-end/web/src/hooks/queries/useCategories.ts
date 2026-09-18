'use client';

import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { categoryKeys } from './keys';

export interface CategoryItem {
  _id: string;
  name: string;
  slug?: string;
  /** Populated by `/categories`, but a bare ObjectId elsewhere. */
  parent?: string | { _id: string } | null;
}

/** `parent` arrives populated from `/categories` and as a bare id elsewhere. */
export const parentIdOf = (c: CategoryItem): string =>
  c.parent ? String(typeof c.parent === 'string' ? c.parent : c.parent._id) : '';

interface CategoriesResponse {
  categories?: CategoryItem[];
  pagination?: { pages?: number; total?: number };
}

/** Runaway guard: 296 categories over a 500 cap is one page, never ten. */
const MAX_PAGES = 10;

/**
 * Fetch the taxonomy, FOLLOWING pagination.
 *
 * `/categories` is capped, and the cap was silently exceeded in production: 296
 * active categories against a limit of 200 meant the default response was page 1
 * of 2, with no error and nothing in the body to make it obvious. A truncated
 * taxonomy does not read as a failure — it reads as "those categories do not
 * exist", which cost the chip strip a whole hub and made a third of the
 * subcategory checkboxes inert.
 *
 * The cap is now 500, so this loop does not fire today. It exists so the same
 * silence cannot return the next time the catalogue outgrows the number.
 */
async function fetchCategories(): Promise<CategoryItem[]> {
  const first = await apiClient.get<CategoriesResponse>('/categories');
  const all = [...(first?.categories ?? [])];

  const pages = Math.min(first?.pagination?.pages ?? 1, MAX_PAGES);
  for (let page = 2; page <= pages; page++) {
    const next = await apiClient.get<CategoriesResponse>(`/categories?page=${page}`);
    all.push(...(next?.categories ?? []));
  }

  return all;
}

/**
 * The shared taxonomy query.
 *
 * Two consumers on a category page wanted the same list — the chip strip, and the
 * check that a `?category=` refinement really belongs to the current hub — and
 * each hand-rolled its own fetch, so one page load made TWO identical
 * `/categories` requests (measured). One query key collapses them, and the entry
 * survives navigation between `/products` and `/categories/<slug>`, so the strip
 * renders from cache on arrival instead of refetching.
 *
 * 10 min staleTime mirrors the origin's own CATEGORY_LIST TTL — there is no point
 * refetching faster than the server will serve something new.
 */
export function useCategories() {
  return useQuery({
    queryKey: categoryKeys.list(),
    queryFn: fetchCategories,
    staleTime: 10 * 60 * 1000,
  });
}

/**
 * Imperative read of the same cache entry, for code paths outside a component
 * (the category page resolves its product scope inside an async effect).
 * `fetchQuery` reuses a fresh entry and dedupes against an in-flight one.
 */
export function useCategoriesFetcher() {
  const queryClient = useQueryClient();
  // Stable identity — callers hold it across renders and put it in effect deps.
  return useCallback(
    () =>
      queryClient.fetchQuery({
        queryKey: categoryKeys.list(),
        queryFn: fetchCategories,
        staleTime: 10 * 60 * 1000,
      }),
    [queryClient]
  );
}
