'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import useIsMounted from '@/lib/hooks/useIsMounted';
import apiClient from '@/lib/api';
import { Search, Clock, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useLocation } from '@/context/LocationContext';
import EnhancedImage from '@/components/layout/EnhancedImage';
import { trackSearch } from '@/lib/analytics';

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

export default function SearchSuggestions() {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const isMounted = useIsMounted();
  const router = useRouter();
  const { user } = useAuth();
  const { currentLocation } = useLocation();
  const timeoutRef = useRef<NodeJS.Timeout | number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionRefs = useRef<(HTMLButtonElement | HTMLDivElement | null)[]>([]);
  suggestionRefs.current = [];

  const storageKey = (() => {
    const userId = user ? user._id : 'guest';
    const locationCode = currentLocation ? currentLocation.selectedAddress.postalCode : 'global';
    return `searchHistory_${userId}_${locationCode}`;
  })();

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedHistory = localStorage.getItem(storageKey);
      if (savedHistory) {
        try {
          setHistory(JSON.parse(savedHistory).slice(0, 10));
        } catch (e) {
          console.error('Failed to parse search history', e);
        }
      }
    }
  }, [storageKey]);

  useEffect(() => {
    if (history.length > 0 && typeof window !== 'undefined') {
      localStorage.setItem(storageKey, JSON.stringify(history));
    }
  }, [history, storageKey]);

  useEffect(() => {
    if (!isMounted) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setActiveIndex(-1);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isMounted]);

  useEffect(() => {
    if (!isMounted) return;
    if (query.length < 2) {
      if (query.length === 0 && history.length > 0 && document.activeElement === inputRef.current) {
        setSuggestions([]);
        setIsOpen(true);
      } else {
        setSuggestions([]);
        setIsOpen(false);
      }
      setActiveIndex(-1);
      return;
    }
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (abortControllerRef.current) abortControllerRef.current.abort(new DOMException('New request', 'AbortError'));
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const timeoutId = setTimeout(async () => {
      setIsLoading(true);
      try {
        const data: any = await apiClient.get(`/products/suggestions?q=${encodeURIComponent(query)}&limit=8`, { signal: controller.signal });
        if (data.success) {
          setSuggestions(data.suggestions || []);
          setIsOpen(true); // Always open when query >= 2 (shows "See all results" row)
        }
      } catch (error: any) {
        if (error.name !== 'AbortError') {
          console.error('Error fetching suggestions:', error);
          setSuggestions([]);
          setIsOpen(true); // Keep open so "See all results" row remains visible
        }
      } finally {
        setIsLoading(false);
      }
    }, 200);
    timeoutRef.current = timeoutId;
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (abortControllerRef.current) abortControllerRef.current.abort(new DOMException('Unmounted', 'AbortError'));
    };
  }, [query, isMounted, history.length]);

  const handleSearch = (searchQuery: string = query) => {
    if (!searchQuery.trim()) return;
    trackSearch(searchQuery.trim(), suggestions.length);
    setHistory(prev => {
      const filtered = prev.filter(i => i.term.toLowerCase() !== searchQuery.trim().toLowerCase());
      return [{ term: searchQuery.trim(), timestamp: Date.now() }, ...filtered].slice(0, 10);
    });
    router.push(`/products/search?search=${encodeURIComponent(searchQuery.trim())}`);
    setIsOpen(false);
    setQuery('');
    setActiveIndex(-1);
  };

  const handleSuggestionClick = (suggestion: Suggestion, e?: React.MouseEvent) => {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    const isProduct = suggestion.type === 'product' || suggestion.slug || (suggestion.value && !suggestion.value.includes(' '));
    if (isProduct) router.push(`/products/${suggestion.slug || suggestion.value || suggestion.id}`);
    else if (suggestion.type === 'brand') router.push(`/products/search?brand=${encodeURIComponent(suggestion.text)}`);
    else if (suggestion.type === 'category') router.push(`/products/search?category=${encodeURIComponent(suggestion.text)}`);
    else { setQuery(suggestion.text); handleSearch(suggestion.text); }
    setIsOpen(false);
  };

  const handleHistoryItemClick = (term: string) => { setQuery(term); handleSearch(term); };
  const clearHistory = () => { setHistory([]); if (typeof window !== 'undefined') localStorage.removeItem(storageKey); };
  const removeFromHistory = (term: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setHistory(prev => prev.filter(i => i.term !== term));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen) return;
    const historyCount = query.length === 0 && history.length > 0 ? history.length : 0;
    const seeAllCount = query.length >= 2 ? 1 : 0;
    const total = historyCount + suggestions.length + seeAllCount;
    switch (e.key) {
      case 'ArrowDown':
        if (total > 0) { e.preventDefault(); setActiveIndex(p => (p + 1) % total); }
        break;
      case 'ArrowUp':
        if (total > 0) { e.preventDefault(); setActiveIndex(p => (p - 1 + total) % total); }
        break;
      case 'Enter':
        e.preventDefault();
        if (activeIndex >= 0 && total > 0) {
          if (historyCount > 0 && activeIndex < historyCount) {
            handleHistoryItemClick(history[activeIndex].term);
          } else {
            const si = activeIndex - historyCount;
            if (si < suggestions.length) {
              handleSuggestionClick(suggestions[si]);
            } else {
              // "See all results" row selected
              handleSearch();
            }
          }
        } else {
          handleSearch();
        }
        break;
      case 'Escape': setIsOpen(false); setActiveIndex(-1); inputRef.current?.blur(); break;
    }
  };

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="flex rounded-sm overflow-hidden border border-hairline focus-within:border-gold transition-colors">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (query.length >= 2 || (query.length === 0 && history.length > 0)) setIsOpen(true);
          }}
          placeholder="Search products, brands, categories..."
          className="w-full px-4 py-2 bg-obsidian-raised text-ink placeholder:text-ink-muted border-0 focus:outline-none font-display"
        />
        <button
          type="button"
          onClick={() => handleSearch()}
          aria-label="Search"
          className="bg-gold hover:bg-gold text-obsidian px-4 py-2 transition-colors"
        >
          <Search className="h-5 w-5" />
        </button>
      </div>

      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-obsidian border border-hairline rounded-sm shadow-2xl">
          {isLoading ? (
            <div className="px-4 py-3 text-ink/70 font-display flex items-center gap-3">
              <svg className="animate-spin h-5 w-5 text-gold" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Searching...
            </div>
          ) : (
            <div className="py-1 max-h-96 overflow-y-auto">
              {/* History */}
              {query.length === 0 && history.length > 0 && (
                <div>
                  <div className="px-4 py-2 flex justify-between items-center border-b border-hairline">
                    <span className="text-xs font-display font-bold text-ink-muted uppercase tracking-widest">Recent Searches</span>
                    <button onClick={clearHistory} className="text-xs text-gold hover:text-ink transition-colors font-display">Clear all</button>
                  </div>
                  <ul>
                    {history.map((item, index) => (
                      <li key={`history-${index}`}>
                        <div
                          ref={(el) => { if (el) suggestionRefs.current[index] = el; }}
                          className={`w-full text-left px-4 py-2 flex items-center justify-between cursor-pointer transition-colors ${
                            activeIndex === index ? 'bg-obsidian-raised' : 'hover:bg-obsidian-raised'
                          }`}
                        >
                          <div className="flex items-center gap-2 grow" onClick={() => handleHistoryItemClick(item.term)}>
                            <Clock className="h-4 w-4 text-ink-muted" />
                            <span className="text-ink/70 font-display">{item.term}</span>
                          </div>
                          <button onClick={(e) => removeFromHistory(item.term, e)} className="text-ink-muted hover:text-ink/70 ml-2 transition-colors">
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Suggestions */}
              {suggestions.length > 0 && (
                <div>
                  <div className="px-4 py-2 border-b border-hairline">
                    <span className="text-xs font-display font-bold text-ink-muted uppercase tracking-widest">Suggestions</span>
                  </div>
                  <ul>
                    {suggestions.map((suggestion, index) => {
                      const actualIndex = index + (query.length === 0 && history.length > 0 ? history.length : 0);
                      return (
                        <li key={suggestion.id}>
                          <button
                            type="button"
                            ref={(el) => { if (el) suggestionRefs.current[actualIndex] = el; }}
                            onClick={(e) => handleSuggestionClick(suggestion, e)}
                            className={`w-full text-left px-4 py-3 flex items-center gap-3 transition-colors ${
                              activeIndex === actualIndex ? 'bg-obsidian-raised' : 'hover:bg-obsidian-raised'
                            }`}
                          >
                            {suggestion.imageUrl && (
                              <div className="shrink-0 w-10 h-10 bg-obsidian-raised rounded-sm overflow-hidden relative">
                                <EnhancedImage
                                  src={suggestion.imageUrl}
                                  alt={suggestion.text}
                                  width={40}
                                  height={40}
                                  className="w-full h-full object-cover"
                                  context="product"
                                />
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="font-display font-bold text-ink truncate uppercase tracking-wide">{suggestion.text}</div>
                              <div className="flex items-center text-xs text-ink-muted font-display">
                                <span className="capitalize">{suggestion.type}</span>
                                {suggestion.category && <><span className="mx-1">·</span><span>{suggestion.category}</span></>}
                              </div>
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {/* "See all results" row — always visible when query is active */}
              {query.length >= 2 && (
                <button
                  type="button"
                  ref={(el) => { if (el) suggestionRefs.current[suggestions.length] = el; }}
                  onClick={() => handleSearch()}
                  className={`w-full text-left px-4 py-3 flex items-center gap-2 transition-colors ${
                    suggestions.length > 0 ? 'border-t border-hairline' : ''
                  } ${activeIndex === suggestions.length ? 'bg-obsidian-raised' : 'hover:bg-obsidian-raised'}`}
                >
                  <Search className="h-4 w-4 text-gold shrink-0" />
                  <span className="text-gold font-display text-sm">
                    See all results for &ldquo;{query}&rdquo; →
                  </span>
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
