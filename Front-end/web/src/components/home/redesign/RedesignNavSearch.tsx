'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { suggestionKeys } from '@/hooks/queries/keys';
import { useAuth } from '@/context/AuthContext';
import { trackSearch } from '@/lib/analytics';
import Img from './Img';
import { Search } from './icons';

interface Suggestion {
  id: string;
  slug?: string;
  text: string;
  value?: string;
  type?: 'product' | 'brand' | 'category';
  category?: string;
  imageUrl?: string;
}

interface HistoryItem {
  term: string;
  timestamp: number;
}

interface SuggestionsResponse {
  success?: boolean;
  suggestions?: Suggestion[];
}

// Recent searches are intentionally capped at 3 — a nav dropdown is glanceable,
// not a history log. `MIN_QUERY` matches the backend suggestion floor (it ignores
// 1-char queries); `DEBOUNCE_MS` keeps us to ~1 request per typing pause.
const MAX_RECENT = 3;
const MIN_QUERY = 2;
const DEBOUNCE_MS = 200;
const SUGGESTION_LIMIT = 6;

const ClockIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} width={15} height={15} {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * Nav search box with live, as-you-type suggestions and a capped recent-searches
 * list. Self-contained: owns its query/suggestion/history state so it can be
 * dropped into both the desktop inline slot and the mobile search bar. Styling is
 * carried by `.nav-search*` / `.nav-search-panel` in home-redesign.css.
 *
 * @param variant  'desktop' (inline nav) or 'mobile' (revealed bar; autofocuses).
 * @param onNavigate  Called right before we route away — lets the parent close the
 *                     mobile menu/search overlay.
 */
export default function RedesignNavSearch({
  variant = 'desktop',
  onNavigate,
}: {
  variant?: 'desktop' | 'mobile';
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const containerRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Per-user key so a shared device doesn't leak one account's searches to the
  // next. Same scheme the legacy header used, so history carries over.
  const storageKey = `searchHistory_${user ? user._id : 'guest'}_global`;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setHistory((JSON.parse(raw) as HistoryItem[]).slice(0, MAX_RECENT));
      else setHistory([]);
    } catch {
      setHistory([]);
    }
  }, [storageKey]);

  const persistHistory = useCallback(
    (items: HistoryItem[]) => {
      const capped = items.slice(0, MAX_RECENT);
      setHistory(capped);
      if (typeof window === 'undefined') return;
      if (capped.length) localStorage.setItem(storageKey, JSON.stringify(capped));
      else localStorage.removeItem(storageKey);
    },
    [storageKey],
  );

  // Close on outside click.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setActiveIndex(-1);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  // Debounced, abortable suggestion fetch. Under MIN_QUERY chars we show nothing
  // (recent searches take over) and never hit the network.
  useEffect(() => {
    const q = query.trim();
    setActiveIndex(-1);
    if (q.length < MIN_QUERY) {
      setSuggestions([]);
      setIsLoading(false);
      if (abortRef.current) abortRef.current.abort();
      return;
    }
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    timeoutRef.current = setTimeout(async () => {
      setIsLoading(true);
      try {
        // Routed through the shared QueryClient so an already-typed term (e.g.
        // the user backspacing and retyping) is served from cache instead of
        // re-hitting the network. staleTime 5min; the debounce/abort below still
        // governs when a NEW term fires. A failed/empty backend response THROWS
        // so it is never cached as a "successful" empty result (which would make
        // a retype within 5min serve stale-empty without retrying). retry:false
        // keeps that intentional throw from double-firing the request.
        const data = await queryClient.fetchQuery<SuggestionsResponse>({
          queryKey: suggestionKeys.query(q),
          queryFn: async () => {
            const res = await apiClient.get<SuggestionsResponse>(
              `/products/suggestions?q=${encodeURIComponent(q)}&limit=${SUGGESTION_LIMIT}`,
              { signal: controller.signal },
            );
            if (!res?.success) throw new Error('suggestions unavailable');
            return res;
          },
          staleTime: 300_000,
          retry: false,
        });
        if (data?.success) {
          setSuggestions(data.suggestions || []);
          setIsOpen(true);
        }
      } catch (err) {
        if ((err as { name?: string })?.name !== 'AbortError') {
          setSuggestions([]);
          setIsOpen(true); // keep the "see all results" row reachable
        }
      } finally {
        setIsLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [query, queryClient]);

  const goToResults = (term: string) => {
    const t = term.trim();
    if (!t) return;
    trackSearch(t, suggestions.length);
    persistHistory([
      { term: t, timestamp: Date.now() },
      ...history.filter((h) => h.term.toLowerCase() !== t.toLowerCase()),
    ]);
    setIsOpen(false);
    setActiveIndex(-1);
    inputRef.current?.blur();
    onNavigate?.();
    router.push(`/products/search?q=${encodeURIComponent(t)}`);
  };

  const openSuggestion = (s: Suggestion) => {
    setIsOpen(false);
    setActiveIndex(-1);
    // A product resolves to a PDP; brand/category deep-link into a filtered search.
    const isProduct = s.type === 'product' || !!s.slug || (!!s.value && !s.value.includes(' '));
    if (isProduct) {
      onNavigate?.();
      router.push(`/products/${s.slug || s.value || s.id}`);
    } else if (s.type === 'brand') {
      onNavigate?.();
      router.push(`/products/search?brand=${encodeURIComponent(s.text)}`);
    } else if (s.type === 'category') {
      onNavigate?.();
      router.push(`/products/search?category=${encodeURIComponent(s.text)}`);
    } else {
      goToResults(s.text);
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    goToResults(query);
  };

  const showRecent = query.trim().length === 0 && history.length > 0;
  const showSeeAll = query.trim().length >= MIN_QUERY;
  const rowCount = showRecent ? history.length : suggestions.length + (showSeeAll ? 1 : 0);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' && (showRecent || showSeeAll)) {
        setIsOpen(true);
        e.preventDefault();
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        if (rowCount) {
          e.preventDefault();
          setActiveIndex((p) => (p + 1) % rowCount);
        }
        break;
      case 'ArrowUp':
        if (rowCount) {
          e.preventDefault();
          setActiveIndex((p) => (p - 1 + rowCount) % rowCount);
        }
        break;
      case 'Enter':
        if (activeIndex >= 0) {
          e.preventDefault();
          if (showRecent) goToResults(history[activeIndex].term);
          else if (activeIndex < suggestions.length) openSuggestion(suggestions[activeIndex]);
          else goToResults(query);
        }
        // activeIndex < 0 → let the form submit naturally (goToResults(query)).
        break;
      case 'Escape':
        setIsOpen(false);
        setActiveIndex(-1);
        inputRef.current?.blur();
        break;
    }
  };

  const onFocus = () => {
    if (query.trim().length >= MIN_QUERY || (query.trim().length === 0 && history.length > 0)) {
      setIsOpen(true);
    }
  };

  const formClass = variant === 'mobile' ? 'nav-search-bar' : 'nav-search nav-search-desktop';
  const panelId = `nav-search-panel-${variant}`;

  return (
    <form
      ref={containerRef}
      className={formClass}
      role="search"
      onSubmit={onSubmit}
      autoComplete="off"
    >
      <Search width={variant === 'mobile' ? 17 : 18} height={variant === 'mobile' ? 17 : 18} />
      <input
        ref={inputRef}
        type="text"
        placeholder="Search parts, brands…"
        aria-label="Search"
        autoFocus={variant === 'mobile'}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        role="combobox"
        aria-expanded={isOpen}
        aria-controls={panelId}
        aria-autocomplete="list"
      />

      {isOpen && (
        <div id={panelId} className="nav-search-panel" role="listbox">
          {showRecent && (
            <div className="nsp-section">
              <div className="nsp-head">
                <span>Recent</span>
                <button type="button" className="nsp-clear" onClick={() => persistHistory([])}>
                  Clear
                </button>
              </div>
              {history.map((h, i) => (
                <button
                  type="button"
                  key={`recent-${h.term}`}
                  className={`nsp-row nsp-recent ${activeIndex === i ? 'is-active' : ''}`}
                  onClick={() => goToResults(h.term)}
                  role="option"
                  aria-selected={activeIndex === i}
                >
                  <ClockIcon className="nsp-clock" />
                  <span className="nsp-recent-term">{h.term}</span>
                  <span
                    className="nsp-remove"
                    role="button"
                    tabIndex={-1}
                    aria-label={`Remove ${h.term}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      persistHistory(history.filter((x) => x.term !== h.term));
                    }}
                  >
                    ×
                  </span>
                </button>
              ))}
            </div>
          )}

          {!showRecent && isLoading && suggestions.length === 0 && (
            <div className="nsp-empty">Searching…</div>
          )}

          {!showRecent && !isLoading && suggestions.length === 0 && showSeeAll && (
            <div className="nsp-empty">No matches — try “See all results”.</div>
          )}

          {!showRecent && suggestions.length > 0 && (
            <div className="nsp-section">
              <div className="nsp-head">
                <span>Suggestions</span>
              </div>
              {suggestions.map((s, i) => (
                <button
                  type="button"
                  key={s.id}
                  className={`nsp-row ${activeIndex === i ? 'is-active' : ''}`}
                  onClick={() => openSuggestion(s)}
                  role="option"
                  aria-selected={activeIndex === i}
                >
                  {s.imageUrl ? (
                    <Img src={s.imageUrl} alt="" className="nsp-thumb" />
                  ) : (
                    <span className="nsp-thumb nsp-thumb-empty" aria-hidden />
                  )}
                  <span className="nsp-text">
                    <span className="nsp-name">{s.text}</span>
                    <span className="nsp-meta">
                      {s.type}
                      {s.category ? ` · ${s.category}` : ''}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}

          {showSeeAll && (
            <button
              type="button"
              className={`nsp-row nsp-seeall ${activeIndex === suggestions.length ? 'is-active' : ''}`}
              onClick={() => goToResults(query)}
              role="option"
              aria-selected={activeIndex === suggestions.length}
            >
              <Search width={14} height={14} />
              <span>See all results for “{query.trim()}”</span>
            </button>
          )}
        </div>
      )}
    </form>
  );
}
