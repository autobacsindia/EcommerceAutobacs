'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { suggestionKeys } from '@/hooks/queries/keys';
import { useAuth } from '@/context/AuthContext';
import { useBrands } from '@/hooks/queries/useBrands';
import { useCategories } from '@/hooks/queries/useCategories';
import { useVehicleMakes } from '@/hooks/queries/useVehicleMakes';
import { trackSearch } from '@/lib/analytics';
import Img from '../redesign/Img';

interface Suggestion {
  id: string;
  slug?: string;
  text: string;
  value?: string;
  type?: 'product' | 'brand' | 'category' | 'make' | 'query';
  category?: string;
  imageUrl?: string;
  /** Where a local (first-letter) suggestion goes. */
  href?: string;
}

interface HistoryItem {
  term: string;
  timestamp: number;
}

const MAX_RECENT = 4;
/** The backend suggester ignores 1-char queries; from 2 chars it takes over. */
const SERVER_MIN = 2;
const DEBOUNCE_MS = 180;
const SUGGESTION_LIMIT = 7;
const LOCAL_LIMIT = 7;

const TYPE_LABEL: Record<string, string> = {
  product: 'Product',
  brand: 'Brand',
  category: 'Category',
  make: 'Car make',
  query: 'Search',
};

const SearchIcon = ({ size = 18 }: { size?: number }) => (
  <svg className="sh-search-ico" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);

/**
 * The header search with live suggestions (the new header had lost the old one's
 * dropdown). From the FIRST letter it suggests brands, car makes and categories
 * that start with it — from data the store already caches — and from the second
 * letter the backend's product suggester takes over, as before. Recent searches
 * show on focus. Keyboard: ↑/↓, Enter, Esc.
 */
export default function StoreSearch() {
  const router = useRouter();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [query, setQuery] = useState('');
  const [remote, setRemote] = useState<Suggestion[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  const [warm, setWarm] = useState(false);

  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abort = useRef<AbortController | null>(null);

  // First-letter sources — only fetched once the shopper touches the box.
  const { data: brands = [] } = useBrands(warm);
  const { data: categories = [] } = useCategories();
  const { data: makes = [] } = useVehicleMakes();

  // Per-user key so a shared device doesn't leak one account's searches to the
  // next. Same scheme the previous headers used, so history carries over.
  const storageKey = `searchHistory_${user ? user._id : 'guest'}_global`;
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      setHistory(raw ? (JSON.parse(raw) as HistoryItem[]).slice(0, MAX_RECENT) : []);
    } catch {
      setHistory([]);
    }
  }, [storageKey]);

  const saveHistory = useCallback(
    (items: HistoryItem[]) => {
      const capped = items.slice(0, MAX_RECENT);
      setHistory(capped);
      try {
        if (capped.length) localStorage.setItem(storageKey, JSON.stringify(capped));
        else localStorage.removeItem(storageKey);
      } catch {
        /* private mode — non-critical */
      }
    },
    [storageKey],
  );

  // Close on outside click.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (formRef.current && !formRef.current.contains(e.target as Node)) {
        setOpen(false);
        setActive(-1);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const q = query.trim();

  // Local, instant suggestions: names that START with what was typed (then contain it).
  const local = useMemo<Suggestion[]>(() => {
    if (!q) return [];
    const needle = q.toLowerCase();
    const rank = (name: string) => {
      const n = name.toLowerCase();
      return n.startsWith(needle) ? 0 : n.includes(` ${needle}`) ? 1 : -1;
    };
    // r = match quality (prefix beats word-start); w = weight within it: car makes,
    // then departments, then brands with the most products — so "b" leads with
    // BMW, Body Kits, Brakes, Bushranger rather than the alphabet.
    const pool: (Suggestion & { r: number; w: number })[] = [];
    for (const m of makes) {
      const r = rank(m.name);
      if (r >= 0) pool.push({ id: `make-${m.name}`, text: m.name, type: 'make', href: `/products?${new URLSearchParams({ vehicleMake: m.name })}`, r, w: 0 });
    }
    for (const b of brands) {
      const r = rank(b.name);
      if (r >= 0) pool.push({ id: `brand-${b.slug}`, text: b.name, type: 'brand', href: `/brands/${b.slug}`, r, w: 2000 - Math.min(b.productCount, 999) });
    }
    for (const c of categories) {
      if (!c?.name || !c.slug || c.parent) continue;
      const r = rank(c.name);
      if (r >= 0) pool.push({ id: `cat-${c.slug}`, text: c.name, type: 'category', href: `/categories/${c.slug}`, r, w: 500 });
    }
    const seen = new Set<string>();
    return pool
      .sort((a, b) => a.r - b.r || a.w - b.w || a.text.localeCompare(b.text))
      .filter((s) => (seen.has(s.text.toLowerCase()) ? false : (seen.add(s.text.toLowerCase()), true)))
      .slice(0, LOCAL_LIMIT);
  }, [q, makes, brands, categories]);

  // Debounced, abortable server suggestions from the second letter on.
  useEffect(() => {
    setActive(-1);
    if (q.length < SERVER_MIN) {
      setRemote([]);
      setLoading(false);
      abort.current?.abort();
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await queryClient.fetchQuery<{ success?: boolean; suggestions?: Suggestion[] }>({
          queryKey: suggestionKeys.query(q),
          queryFn: async () => {
            const res = await apiClient.get<{ success?: boolean; suggestions?: Suggestion[] }>(
              `/products/suggestions?q=${encodeURIComponent(q)}&limit=${SUGGESTION_LIMIT}`,
              { signal: controller.signal },
            );
            // Throw on failure so an error is never cached as "no suggestions".
            if (!res?.success) throw new Error('suggestions unavailable');
            return res;
          },
          staleTime: 300_000,
          retry: false,
        });
        setRemote((data?.suggestions || []).filter((s) => s.type !== 'query'));
      } catch (err) {
        if ((err as { name?: string })?.name !== 'AbortError') setRemote([]);
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q, queryClient]);

  // One letter → local matches only; two or more → server products first, then
  // any local brand/make/category matches the server did not already return.
  const suggestions = useMemo(() => {
    if (q.length < SERVER_MIN) return local;
    const texts = new Set(remote.map((s) => s.text.toLowerCase()));
    return [...remote, ...local.filter((s) => !texts.has(s.text.toLowerCase()))].slice(0, SUGGESTION_LIMIT + 3);
  }, [q, local, remote]);

  const showRecent = q.length === 0 && history.length > 0;
  const showSeeAll = q.length > 0;
  const rows = showRecent ? history.length : suggestions.length + (showSeeAll ? 1 : 0);

  const close = () => {
    setOpen(false);
    setActive(-1);
    inputRef.current?.blur();
  };

  const goToResults = (term: string) => {
    const t = term.trim();
    if (!t) return;
    trackSearch(t, suggestions.length);
    saveHistory([{ term: t, timestamp: Date.now() }, ...history.filter((h) => h.term.toLowerCase() !== t.toLowerCase())]);
    close();
    router.push(`/products/search?q=${encodeURIComponent(t)}`);
  };

  const openSuggestion = (s: Suggestion) => {
    close();
    if (s.href) return router.push(s.href);
    if (s.type === 'product' || s.slug) return router.push(`/products/${s.slug || s.value || s.id}`);
    if (s.type === 'brand') return router.push(`/products/search?brand=${encodeURIComponent(s.text)}`);
    if (s.type === 'category') return router.push(`/products/search?category=${encodeURIComponent(s.text)}`);
    goToResults(s.text);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') return close();
    if (!rows) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((p) => (p + 1) % rows);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      setActive((p) => (p - 1 + rows) % rows);
    } else if (e.key === 'Enter' && open && active >= 0) {
      e.preventDefault();
      if (showRecent) goToResults(history[active].term);
      else if (active < suggestions.length) openSuggestion(suggestions[active]);
      else goToResults(query);
    }
  };

  const panelOpen = open && (showRecent || showSeeAll);

  return (
    <form
      ref={formRef}
      className="sh-search"
      role="search"
      autoComplete="off"
      onSubmit={(e) => {
        e.preventDefault();
        goToResults(query);
      }}
    >
      <SearchIcon />
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          setWarm(true);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        placeholder="Search parts, brands or your car model"
        aria-label="Search products"
        aria-expanded={panelOpen}
        aria-controls="sh-search-panel"
        aria-autocomplete="list"
        aria-activedescendant={panelOpen && active >= 0 ? `sh-sugg-${active}` : undefined}
      />
      <button type="submit" className="sh-go" aria-label="Search">Go</button>

      {panelOpen && (
        <div id="sh-search-panel" className="sh-sugg" role="listbox" aria-label="Search suggestions">
          {showRecent && (
            <>
              <div className="sh-sugg-head">
                <span>Recent searches</span>
                <button type="button" className="sh-sugg-clear" onClick={() => saveHistory([])}>Clear</button>
              </div>
              {history.map((h, i) => (
                <button
                  type="button"
                  key={h.term}
                  id={`sh-sugg-${i}`}
                  role="option"
                  aria-selected={active === i}
                  className={`sh-sugg-row${active === i ? ' is-active' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => goToResults(h.term)}
                >
                  <span className="sh-sugg-ico" aria-hidden="true">↺</span>
                  <span className="sh-sugg-text"><span className="sh-sugg-name">{h.term}</span></span>
                </button>
              ))}
            </>
          )}

          {!showRecent && suggestions.map((s, i) => (
            <button
              type="button"
              key={s.id}
              id={`sh-sugg-${i}`}
              role="option"
              aria-selected={active === i}
              className={`sh-sugg-row${active === i ? ' is-active' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => openSuggestion(s)}
            >
              {s.imageUrl ? (
                <Img src={s.imageUrl} alt="" className="sh-sugg-thumb" sizes="40px" />
              ) : (
                <span className="sh-sugg-ico" aria-hidden="true"><SearchIcon size={15} /></span>
              )}
              <span className="sh-sugg-text">
                <span className="sh-sugg-name">{s.text}</span>
                <span className="sh-sugg-meta">
                  {TYPE_LABEL[s.type || 'product'] || 'Product'}
                  {s.category ? ` · ${s.category}` : ''}
                </span>
              </span>
            </button>
          ))}

          {!showRecent && loading && suggestions.length === 0 && <div className="sh-sugg-empty">Searching…</div>}

          {showSeeAll && (
            <button
              type="button"
              id={`sh-sugg-${suggestions.length}`}
              role="option"
              aria-selected={active === suggestions.length}
              className={`sh-sugg-row sh-sugg-all${active === suggestions.length ? ' is-active' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => goToResults(query)}
            >
              <span className="sh-sugg-ico" aria-hidden="true"><SearchIcon size={15} /></span>
              <span className="sh-sugg-text"><span className="sh-sugg-name">See all results for “{q}”</span></span>
            </button>
          )}
        </div>
      )}
    </form>
  );
}
