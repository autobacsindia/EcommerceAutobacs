'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import useIsMounted from '@/lib/hooks/useIsMounted';
import apiClient from '@/lib/api';
import { Search, Clock, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useLocation } from '@/contexts/LocationContext';
import EnhancedImage from '@/components/layout/EnhancedImage';

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
          setIsOpen((data.suggestions || []).length > 0 || history.length > 0);
        }
      } catch (error: any) {
        if (error.name !== 'AbortError') console.error('Error fetching suggestions:', error);
        setSuggestions([]);
        setIsOpen(false);
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

  const handleSearch = async (searchQuery: string = query) => {
    if (!searchQuery.trim()) return;
    setHistory(prev => {
      const filtered = prev.filter(i => i.term.toLowerCase() !== searchQuery.trim().toLowerCase());
      return [{ term: searchQuery.trim(), timestamp: Date.now() }, ...filtered].slice(0, 10);
    });
    const trimmed = searchQuery.trim().toLowerCase();
    let current = suggestions;
    if (current.length === 0 && trimmed.length >= 2) {
      try {
        const data: any = await apiClient.get(`/products/suggestions?q=${encodeURIComponent(searchQuery.trim())}&limit=8`);
        if (data.success) current = data.suggestions || [];
      } catch {}
    }
    const match = current.find(s => s.type === 'product' && s.text.toLowerCase() === trimmed && s.slug)
      || current.find(s => s.type === 'product' && trimmed.includes(s.text.toLowerCase()) && s.slug)
      || current.find(s => s.type === 'product' && s.text.toLowerCase().includes(trimmed) && s.slug);
    if (match) router.push(`/products/${match.slug}`);
    else router.push(`/products/search?search=${encodeURIComponent(searchQuery.trim())}`);
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
    const total = suggestions.length + (query.length === 0 && history.length > 0 ? history.length : 0);
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); setActiveIndex(p => (p + 1) % total); break;
      case 'ArrowUp': e.preventDefault(); setActiveIndex(p => (p - 1 + total) % total); break;
      case 'Enter':
        e.preventDefault();
        if (activeIndex >= 0) {
          if (query.length === 0 && history.length > 0 && activeIndex < history.length) {
            handleHistoryItemClick(history[activeIndex].term);
          } else {
            const si = activeIndex - (query.length === 0 && history.length > 0 ? history.length : 0);
            if (si < suggestions.length) handleSuggestionClick(suggestions[si]);
          }
        } else handleSearch();
        break;
      case 'Escape': setIsOpen(false); setActiveIndex(-1); inputRef.current?.blur(); break;
    }
  };

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="flex rounded-sm overflow-hidden border border-[#252525] focus-within:border-[#3B9EE8] transition-colors">
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
          className="w-full px-4 py-2 bg-[#161616] text-white placeholder:text-[#555555] border-0 focus:outline-none font-body"
        />
        <button
          type="button"
          onClick={() => handleSearch()}
          aria-label="Search"
          className="bg-[#3B9EE8] hover:bg-[#1A6FB5] text-white px-4 py-2 transition-colors"
        >
          <Search className="h-5 w-5" />
        </button>
      </div>

      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-[#0E0E0E] border border-[#252525] rounded-sm shadow-2xl">
          {isLoading ? (
            <div className="px-4 py-3 text-[#C4C4C4] font-body flex items-center gap-3">
              <svg className="animate-spin h-5 w-5 text-[#3B9EE8]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
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
                  <div className="px-4 py-2 flex justify-between items-center border-b border-[#252525]">
                    <span className="text-xs font-condensed font-bold text-[#555555] uppercase tracking-widest">Recent Searches</span>
                    <button onClick={clearHistory} className="text-xs text-[#3B9EE8] hover:text-white transition-colors font-body">Clear all</button>
                  </div>
                  <ul>
                    {history.map((item, index) => (
                      <li key={`history-${index}`}>
                        <div
                          ref={(el) => { if (el) suggestionRefs.current[index] = el; }}
                          className={`w-full text-left px-4 py-2 flex items-center justify-between cursor-pointer transition-colors ${
                            activeIndex === index ? 'bg-[#161616]' : 'hover:bg-[#161616]'
                          }`}
                        >
                          <div className="flex items-center gap-2 grow" onClick={() => handleHistoryItemClick(item.term)}>
                            <Clock className="h-4 w-4 text-[#555555]" />
                            <span className="text-[#C4C4C4] font-body">{item.term}</span>
                          </div>
                          <button onClick={(e) => removeFromHistory(item.term, e)} className="text-[#555555] hover:text-[#C4C4C4] ml-2 transition-colors">
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
                  <div className="px-4 py-2 border-b border-[#252525]">
                    <span className="text-xs font-condensed font-bold text-[#555555] uppercase tracking-widest">Suggestions</span>
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
                              activeIndex === actualIndex ? 'bg-[#161616]' : 'hover:bg-[#161616]'
                            }`}
                          >
                            {suggestion.imageUrl && (
                              <div className="shrink-0 w-10 h-10 bg-[#252525] rounded-sm overflow-hidden relative">
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
                              <div className="font-condensed font-bold text-white truncate uppercase tracking-wide">{suggestion.text}</div>
                              <div className="flex items-center text-xs text-[#555555] font-body">
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

              {query.length >= 2 && suggestions.length === 0 && (
                <div className="px-4 py-3 text-[#555555] font-body">
                  No suggestions found for &ldquo;{query}&rdquo;
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
