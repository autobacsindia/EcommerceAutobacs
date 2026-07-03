'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';

/**
 * Category picker for the product create/edit forms.
 *
 * The taxonomy is a 2-level tree (hubs → sub-categories). A flat multi-select
 * hid that structure and invited over-tagging — admins would tick both a hub
 * ("Accessories") AND one of its subs ("Interior") for the same product. Because
 * search/facets already expand a hub to its whole subtree, tagging the leaf is
 * enough; the redundant hub tag double-counted the product in category rollups.
 *
 * This component fixes that at the source:
 *  - Sub-categories render grouped under (and indented below) their hub.
 *  - Selecting a category drops any of its already-selected ANCESTORS or
 *    DESCENDANTS, so a product can never be tagged with both a hub and a node
 *    inside that hub. The last click wins (pick a sub to narrow, pick the hub
 *    to broaden) and the "tag the leaf" invariant always holds.
 *
 * Depth-agnostic: it walks `parent` pointers, so it keeps working if the tree
 * ever grows beyond two levels. Categories whose parent isn't in the list
 * (inactive/orphaned) fall into an "Ungrouped" bucket rather than disappearing.
 */

export interface CategoryOption {
  _id: string;
  name: string;
  /** Populated object, raw id, or null for top-level hubs. */
  parent?: string | { _id: string } | null;
}

interface CategoryMultiSelectProps {
  categories: CategoryOption[];
  /** Selected category ids (controlled). */
  selected: string[];
  onChange: (next: string[]) => void;
  label?: string;
  loading?: boolean;
  disabled?: boolean;
}

const parentIdOf = (c: CategoryOption): string | null => {
  const p = c.parent;
  if (!p) return null;
  return typeof p === 'string' ? p : (p._id ?? null);
};

const UNGROUPED = '__ungrouped__';

export default function CategoryMultiSelect({
  categories,
  selected,
  onChange,
  label = 'Categories',
  loading = false,
  disabled = false,
}: CategoryMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Close on outside click or Escape — the flat version never closed on blur.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (open) searchInputRef.current?.focus();
  }, [open]);

  const byId = useMemo(
    () => new Map(categories.map((c) => [c._id, c])),
    [categories]
  );

  // Ancestor chain (parent, grandparent, …) using parent pointers, with a depth
  // cap so a corrupt cycle can't spin forever.
  const ancestorsOf = useMemo(() => {
    const cache = new Map<string, Set<string>>();
    const compute = (id: string): Set<string> => {
      if (cache.has(id)) return cache.get(id)!;
      const acc = new Set<string>();
      let current = byId.get(id);
      let guard = 0;
      while (current && guard++ < 32) {
        const pid = parentIdOf(current);
        if (!pid || acc.has(pid) || pid === id) break;
        acc.add(pid);
        current = byId.get(pid);
      }
      cache.set(id, acc);
      return acc;
    };
    return compute;
  }, [byId]);

  // parentId → children, plus the hub ordering as delivered by the API.
  const { hubs, childrenByHub, descendantsOf } = useMemo(() => {
    const childrenByHub = new Map<string, CategoryOption[]>();
    const hubs: CategoryOption[] = [];

    for (const c of categories) {
      const pid = parentIdOf(c);
      if (!pid) {
        hubs.push(c);
        continue;
      }
      // Parent present in the list → nest under it; otherwise treat as ungrouped.
      const bucket = byId.has(pid) ? pid : UNGROUPED;
      if (!childrenByHub.has(bucket)) childrenByHub.set(bucket, []);
      childrenByHub.get(bucket)!.push(c);
    }

    // Full descendant set for the conflict guard (handles >2 levels).
    const descendantsOf = (id: string): Set<string> => {
      const acc = new Set<string>();
      const stack = [...(childrenByHub.get(id) ?? [])];
      let guard = 0;
      while (stack.length && guard++ < 5000) {
        const node = stack.pop()!;
        if (acc.has(node._id)) continue;
        acc.add(node._id);
        stack.push(...(childrenByHub.get(node._id) ?? []));
      }
      return acc;
    };

    return { hubs, childrenByHub, descendantsOf };
  }, [categories, byId]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const toggle = (id: string) => {
    if (disabled) return;
    if (selectedSet.has(id)) {
      onChange(selected.filter((x) => x !== id));
      return;
    }
    // Invariant: no selected category may be an ancestor or descendant of
    // another. Drop conflicting relatives, then add this one.
    const conflicts = new Set<string>([...ancestorsOf(id), ...descendantsOf(id)]);
    onChange([...selected.filter((x) => !conflicts.has(x)), id]);
  };

  // Human-readable chip label: "Hub › Sub" for sub-categories so identical leaf
  // names under different hubs stay distinguishable.
  const labelFor = (id: string): string => {
    const cat = byId.get(id);
    if (!cat) return id;
    const pid = parentIdOf(cat);
    const parent = pid ? byId.get(pid) : null;
    return parent ? `${parent.name} › ${cat.name}` : cat.name;
  };

  const q = search.trim().toLowerCase();
  const matches = (c: CategoryOption) => c.name.toLowerCase().includes(q);

  // Groups to render. A hub group appears when the hub matches (show all its
  // children) or any child matches (show the hub header + matching children).
  const visibleGroups = useMemo(() => {
    const groups: { hub: CategoryOption | null; hubId: string; children: CategoryOption[] }[] = [];
    const pushGroup = (hub: CategoryOption | null, hubId: string) => {
      const kids = childrenByHub.get(hubId) ?? [];
      const hubMatches = hub ? matches(hub) : false;
      const shownKids = q && !hubMatches ? kids.filter(matches) : kids;
      const hubVisible = hub && (!q || hubMatches);
      if (hubVisible || shownKids.length > 0) {
        groups.push({ hub: hubVisible ? hub : null, hubId, children: shownKids });
      }
    };
    for (const hub of hubs) pushGroup(hub, hub._id);
    if (childrenByHub.has(UNGROUPED)) pushGroup(null, UNGROUPED);
    return groups;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hubs, childrenByHub, q]);

  const hasResults = visibleGroups.length > 0;

  const Row = ({ cat, indented }: { cat: CategoryOption; indented: boolean }) => {
    const checked = selectedSet.has(cat._id);
    return (
      <div
        role="option"
        aria-selected={checked}
        tabIndex={0}
        className={`flex items-center py-2 pr-3 rounded cursor-pointer hover:bg-gray-100 focus:bg-gray-100 focus:outline-none ${
          indented ? 'pl-8' : 'pl-3 font-medium'
        }`}
        onClick={(e) => {
          e.stopPropagation();
          toggle(cat._id);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle(cat._id);
          }
        }}
      >
        <input
          type="checkbox"
          checked={checked}
          readOnly
          tabIndex={-1}
          className="mr-2 h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 pointer-events-none"
        />
        <span className="text-gray-900">{cat.name}</span>
      </div>
    );
  };

  return (
    <div className="relative" ref={containerRef}>
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      )}

      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label || 'Categories'}
        onClick={() => setOpen((o) => !o)}
        className={`w-full px-3 py-2 border border-gray-300 rounded-md bg-white min-h-10.5 flex items-center flex-wrap gap-1 text-left ${
          disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
        }`}
      >
        {selected.length > 0 ? (
          selected.map((id) => (
            <span
              key={id}
              className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full flex items-center"
            >
              {labelFor(id)}
              <span
                role="button"
                tabIndex={0}
                aria-label={`Remove ${labelFor(id)}`}
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(id);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    toggle(id);
                  }
                }}
                className="ml-1 text-blue-600 hover:text-blue-900 cursor-pointer"
              >
                <X className="h-3 w-3" />
              </span>
            </span>
          ))
        ) : (
          <span className="text-gray-400">Select categories…</span>
        )}
        <ChevronDown className="h-4 w-4 text-gray-400 ml-auto shrink-0" />
      </button>

      {open && (
        <div
          role="listbox"
          aria-multiselectable
          className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-xl max-h-72 overflow-y-auto"
        >
          <div className="p-2 border-b sticky top-0 bg-white z-10">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search categories…"
                className="w-full pl-8 pr-2 py-1 border border-gray-200 rounded text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
            <p className="mt-1 text-[11px] text-gray-400 px-0.5">
              Tag the most specific sub-category — picking a sub replaces its hub.
            </p>
          </div>

          {loading ? (
            <div className="px-3 py-3 text-gray-500 text-sm text-center">Loading categories…</div>
          ) : !hasResults ? (
            <div className="px-3 py-3 text-gray-500 text-sm text-center">No matching categories</div>
          ) : (
            <div className="py-1">
              {visibleGroups.map((group) => (
                <div key={group.hubId} className="py-0.5">
                  {group.hub ? (
                    <Row cat={group.hub} indented={false} />
                  ) : (
                    <div className="px-3 pt-2 pb-1 text-[11px] uppercase tracking-wide text-gray-400">
                      Ungrouped
                    </div>
                  )}
                  {group.children.map((child) => (
                    <Row key={child._id} cat={child} indented />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
