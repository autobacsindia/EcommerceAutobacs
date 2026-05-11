'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import useIsMounted from '@/lib/hooks/useIsMounted';
import apiClient from '@/lib/api';
import { generateDeterministicId } from '@/lib/utils/idGenerator';
import { Search, Clock, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useLocation } from '@/contexts/LocationContext';
import EnhancedImage from '@/components/layout/EnhancedImage';

// Define a suggestion type with more information
interface Suggestion {
  id: string;
  slug?: string;
  text: string;
  value?: string;
  type?: 'product' | 'brand' | 'category';
  category?: string;
  imageUrl?: string;
}

// Define a history item type
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
  
  // Reset refs on each render to prevent stale references
  suggestionRefs.current = [];
  
  // Create a storage key that depends on user ID and location
  const storageKey = (() => {
    const userId = user ? user._id : 'guest';
    const locationCode = currentLocation ? currentLocation.selectedAddress.postalCode : 'global';
    return `searchHistory_${userId}_${locationCode}`;
  })();
  
  // Load search history from localStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedHistory = localStorage.getItem(storageKey);
      if (savedHistory) {
        try {
          const parsedHistory = JSON.parse(savedHistory);
          // Only keep the 10 most recent items
          const recentHistory = parsedHistory.slice(0, 10);
          setHistory(recentHistory);
        } catch (e) {
          console.error('Failed to parse search history', e);
        }
      }
    }
  }, [storageKey]);

  // Save search history to localStorage whenever it changes
  useEffect(() => {
    if (history.length > 0 && typeof window !== 'undefined') {
      localStorage.setItem(storageKey, JSON.stringify(history));
    }
  }, [history, storageKey]);

  // Handle click outside to close suggestions
  useEffect(() => {
    if (!isMounted) return; // Don't attach listener until mounted

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setActiveIndex(-1);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isMounted]);

  // Fetch suggestions with debounce
  useEffect(() => {
    if (!isMounted) return; // Don't fetch until mounted

    if (query.length < 2) {
      // Show history when query is empty or too short
      if (query.length === 0 && history.length > 0) {
        setSuggestions([]);
        // Only open if the input is currently focused
        if (document.activeElement === inputRef.current) {
          setIsOpen(true);
        }
      } else {
        setSuggestions([]);
        setIsOpen(false);
      }
      setActiveIndex(-1);
      return;
    }

    // Clear previous timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Abort any previous request with a reason
    if (abortControllerRef.current) {
      abortControllerRef.current.abort(new DOMException('New request initiated, cancelling previous', 'AbortError'));
    }

    // Create abort controller for this request
    const controller = new AbortController();
    abortControllerRef.current = controller;
    
    // Set new timeout
    const timeoutId = setTimeout(async () => {
      setIsLoading(true);
      try {
        // Enhanced API endpoint that returns richer suggestion data
        const data: any = await apiClient.get(`/products/suggestions?q=${encodeURIComponent(query)}&limit=8`, {
          signal: controller.signal
        });
        if (data.success) {
          console.log('[SearchSuggestions] API response suggestions:', data.suggestions);
          setSuggestions(data.suggestions || []);
          setIsOpen((data.suggestions || []).length > 0 || history.length > 0);
        }
      } catch (error: any) {
        // Don't log abort errors as they're expected during cleanup
        if (error.name !== 'AbortError') {
          console.error('Error fetching suggestions:', error);
        }
        setSuggestions([]);
        setIsOpen(false);
      } finally {
        setIsLoading(false);
      }
    }, 200); // Reduced debounce time for better responsiveness

    timeoutRef.current = timeoutId;

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      // Abort any ongoing request with a reason
      if (abortControllerRef.current) {
        abortControllerRef.current.abort(new DOMException('Component unmounted or request cancelled', 'AbortError'));
      }
    };
  }, [query, isMounted, history.length]);

  const handleSearch = async (searchQuery: string = query) => {
    if (searchQuery.trim()) {
      // Add to search history
      const newHistoryItem: HistoryItem = {
        term: searchQuery.trim(),
        timestamp: Date.now()
      };
      
      // Update history, keeping only unique terms and limiting to 10 items
      setHistory(prevHistory => {
        const filteredHistory = prevHistory.filter(item => item.term.toLowerCase() !== searchQuery.trim().toLowerCase());
        return [newHistoryItem, ...filteredHistory].slice(0, 10);
      });
      
      // SMART SEARCH: Check if query exactly matches a product name from suggestions
      const trimmedQuery = searchQuery.trim().toLowerCase();
      const exactProductMatch = suggestions.find(s => 
        s.type === 'product' && 
        s.text.toLowerCase() === trimmedQuery &&
        s.slug
      );
      
      if (exactProductMatch) {
        // Exact match found - navigate directly to product page
        console.log('[SearchSuggestions] Exact product match found, navigating directly to:', exactProductMatch.slug);
        router.push(`/products/${exactProductMatch.slug}`);
      } else {
        // No exact match - go to search results page
        console.log('[SearchSuggestions] No exact match, navigating to search results');
        router.push(`/products/search?search=${encodeURIComponent(searchQuery.trim())}`);
      }
      
      setIsOpen(false);
      setQuery('');
      setActiveIndex(-1);
    }
  };

  const handleSuggestionClick = (suggestion: Suggestion, e?: React.MouseEvent) => {
    // Prevent any form submission or event bubbling
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    
    console.log('[SearchSuggestions] Clicked suggestion:', suggestion);
    console.log('[SearchSuggestions] Suggestion type:', suggestion.type);
    console.log('[SearchSuggestions] Suggestion slug:', suggestion.slug);
    console.log('[SearchSuggestions] Suggestion value:', suggestion.value);
    console.log('[SearchSuggestions] Suggestion text:', suggestion.text);
    console.log('[SearchSuggestions] Has slug?', !!suggestion.slug);
    console.log('[SearchSuggestions] Has value?', !!suggestion.value);
    
    // Handle product suggestions - navigate directly to product page
    // Check multiple conditions to ensure we navigate to product page
    const isProduct = suggestion.type === 'product' || 
                      suggestion.slug || 
                      (suggestion.value && !suggestion.value.includes(' ')); // slug has no spaces
    
    if (isProduct) {
      // Use slug if available, fallback to value, then id
      const productSlug = suggestion.slug || suggestion.value || suggestion.id;
      const productPath = `/products/${productSlug}`;
      console.log('[SearchSuggestions] ✅ Navigating to product page:', productPath);
      router.push(productPath);
    } else if (suggestion.type === 'brand') {
      console.log('[SearchSuggestions] Navigating to brand page');
      router.push(`/products/search?brand=${encodeURIComponent(suggestion.text)}`);
    } else if (suggestion.type === 'category') {
      console.log('[SearchSuggestions] Navigating to category page');
      router.push(`/products/search?category=${encodeURIComponent(suggestion.text)}`);
    } else {
      // Fallback: perform text search
      console.log('[SearchSuggestions] ❌ Performing text search with:', suggestion.text);
      setQuery(suggestion.text);
      handleSearch(suggestion.text);
    }
    setIsOpen(false);
  };

  const handleHistoryItemClick = (term: string) => {
    setQuery(term);
    handleSearch(term);
  };

  const clearHistory = () => {
    setHistory([]);
    if (typeof window !== 'undefined') {
      localStorage.removeItem(storageKey);
    }
  };

  const removeFromHistory = (term: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setHistory(prevHistory => prevHistory.filter(item => item.term !== term));
  };

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen) return;

    const totalItems = suggestions.length + (query.length === 0 && history.length > 0 ? history.length : 0);

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex(prevIndex => (prevIndex + 1) % totalItems);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex(prevIndex => (prevIndex - 1 + totalItems) % totalItems);
        break;
      case 'Enter':
        e.preventDefault();
        if (activeIndex >= 0) {
          if (query.length === 0 && history.length > 0 && activeIndex < history.length) {
            // Select history item
            handleHistoryItemClick(history[activeIndex].term);
          } else if (activeIndex >= (query.length === 0 && history.length > 0 ? history.length : 0)) {
            // Select suggestion item
            const suggestionIndex = activeIndex - (query.length === 0 && history.length > 0 ? history.length : 0);
            if (suggestionIndex < suggestions.length) {
              handleSuggestionClick(suggestions[suggestionIndex]);
            }
          }
        } else {
          // No active selection, search with current query
          handleSearch();
        }
        break;
      case 'Escape':
        setIsOpen(false);
        setActiveIndex(-1);
        inputRef.current?.blur();
        break;
    }
  };

  return (
    <div className="relative w-full">
      <div className="flex rounded-md overflow-hidden shadow-sm">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (query.length >= 2 || (query.length === 0 && history.length > 0)) {
              setIsOpen(true);
            }
          }}
          placeholder="Search products, brands, categories..."
          className="w-full px-4 py-2 bg-white text-gray-900 placeholder-gray-500 border-0 focus:outline-none focus:ring-2 focus:ring-white"
        />
        <button 
          type="button"
          onClick={() => handleSearch()}
          aria-label="Search"
          className="bg-white text-green-800 px-4 py-2 hover:bg-gray-50 transition-colors border-l border-gray-200"
        >
          <Search className="h-5 w-5" />
        </button>
      </div>

      {/* Suggestions dropdown */}
      {isOpen && (
        <div ref={containerRef} className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg">
          {isLoading ? (
            <div className="px-4 py-2 text-gray-500">
              <div className="flex items-center">
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Searching...
              </div>
            </div>
          ) : (
            <div className="py-1 max-h-96 overflow-y-auto">
              {/* Search History Section */}
              {query.length === 0 && history.length > 0 && (
                <div>
                  <div className="px-4 py-2 text-xs font-semibold text-gray-500 flex justify-between items-center">
                    <span>Recent Searches</span>
                    <button 
                      onClick={clearHistory}
                      className="text-blue-600 hover:text-blue-800"
                    >
                      Clear all
                    </button>
                  </div>
                  <ul>
                    {history.map((item, index) => (
                      <li key={`history-${index}`}>
                        {/* Changed from button to div to avoid nesting buttons */}
                        <div
                          ref={(el) => { if (el) suggestionRefs.current[index] = el; }}
                          className={`w-full text-left px-4 py-2 hover:bg-gray-100 focus:bg-gray-100 focus:outline-none flex items-center justify-between cursor-pointer ${
                            activeIndex === index ? 'bg-gray-100' : ''
                          }`}
                        >
                          <div 
                            className="flex items-center gap-2 flex-grow"
                            onClick={() => handleHistoryItemClick(item.term)}
                          >
                            <Clock className="h-4 w-4 text-gray-400" />
                            <span className="text-gray-700">{item.term}</span>
                          </div>
                          <button 
                            onClick={(e) => removeFromHistory(item.term, e)}
                            className="text-gray-400 hover:text-gray-600 ml-2"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Suggestions Section */}
              {suggestions.length > 0 && (
                <div>
                  <div className="px-4 py-2 text-xs font-semibold text-gray-500">
                    Suggestions ({suggestions.length})
                  </div>
                  <ul>
                    {suggestions.map((suggestion, index) => {
                      const actualIndex = index + (query.length === 0 && history.length > 0 ? history.length : 0);
                      console.log(`[SearchSuggestions] Rendering suggestion ${index}:`, suggestion);
                      return (
                        <li key={suggestion.id}>
                          <button
                            type="button"
                            ref={(el) => { if (el) suggestionRefs.current[actualIndex] = el; }}
                            onClick={(e) => {
                              console.log('[SearchSuggestions] Button clicked for:', suggestion.text);
                              handleSuggestionClick(suggestion, e);
                            }}
                            className={`w-full text-left px-4 py-3 hover:bg-gray-100 focus:bg-gray-100 focus:outline-none flex items-center gap-3 ${
                              activeIndex === actualIndex ? 'bg-gray-100' : ''
                            }`}
                          >
                            {suggestion.imageUrl && (
                              <div className="flex-shrink-0 w-10 h-10 bg-gray-200 rounded-md overflow-hidden relative">
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
                              <div className="font-medium text-gray-900 truncate">{suggestion.text}</div>
                              <div className="flex items-center text-xs text-gray-500">
                                <span className="capitalize">{suggestion.type}</span>
                                {suggestion.category && (
                                  <>
                                    <span className="mx-1">•</span>
                                    <span>{suggestion.category}</span>
                                  </>
                                )}
                              </div>
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {/* No results message */}
              {query.length >= 2 && suggestions.length === 0 && (
                <div className="px-4 py-3 text-gray-500">
                  No suggestions found for "{query}"
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
