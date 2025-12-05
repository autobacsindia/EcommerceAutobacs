'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import useIsMounted from '@/lib/hooks/useIsMounted';
import apiClient from '@/lib/api';
import { generateDeterministicId } from '@/lib/utils/idGenerator';
import EnvironmentAwareComponent from './EnvironmentAwareComponent';
import { Search, Clock, X } from 'lucide-react';

// Define a suggestion type with more information
interface Suggestion {
  id: string;
  text: string;
  type: 'product' | 'brand' | 'category';
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
  const timeoutRef = useRef<NodeJS.Timeout | number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionRefs = useRef<(HTMLButtonElement | HTMLDivElement)[]>([]);
  
  // Load search history from localStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedHistory = localStorage.getItem('searchHistory');
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
  }, []);

  // Save search history to localStorage whenever it changes
  useEffect(() => {
    if (history.length > 0 && typeof window !== 'undefined') {
      localStorage.setItem('searchHistory', JSON.stringify(history));
    }
  }, [history]);

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
        setIsOpen(true);
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

  const handleSearch = (searchQuery: string = query) => {
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
      
      router.push(`/search?search=${encodeURIComponent(searchQuery.trim())}`);
      setIsOpen(false);
      setQuery('');
      setActiveIndex(-1);
    }
  };

  const handleSuggestionClick = (suggestion: Suggestion) => {
    setQuery(suggestion.text);
    handleSearch(suggestion.text);
  };

  const handleHistoryItemClick = (term: string) => {
    setQuery(term);
    handleSearch(term);
  };

  const clearHistory = () => {
    setHistory([]);
    if (typeof window !== 'undefined') {
      localStorage.removeItem('searchHistory');
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

  // Use EnvironmentAwareComponent for consistent rendering
  return (
    <EnvironmentAwareComponent 
      skeletonType="search"
      fallback={
        <div className="relative w-full max-w-md">
          <div className="flex">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search products..."
              className="w-full px-4 py-2 border border-gray-300 rounded-l-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              readOnly
            />
            <button 
              className="bg-blue-600 text-white px-4 py-2 rounded-r-md hover:bg-blue-700 transition-colors"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </button>
          </div>
        </div>
      }
    >
      <div ref={containerRef} className="relative w-full max-w-md">
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
            onClick={() => handleSearch()}
            className="bg-white text-green-800 px-4 py-2 hover:bg-gray-50 transition-colors border-l border-gray-200"
          >
            <Search className="h-5 w-5" />
          </button>
        </div>

        {/* Suggestions dropdown */}
        {isOpen && (
          <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg">
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
                      Suggestions
                    </div>
                    <ul>
                      {suggestions.map((suggestion, index) => {
                        const actualIndex = index + (query.length === 0 && history.length > 0 ? history.length : 0);
                        return (
                          <li key={suggestion.id}>
                            <button
                              ref={(el) => { if (el) suggestionRefs.current[actualIndex] = el; }}
                              onClick={() => handleSuggestionClick(suggestion)}
                              className={`w-full text-left px-4 py-3 hover:bg-gray-100 focus:bg-gray-100 focus:outline-none flex items-center gap-3 ${
                                activeIndex === actualIndex ? 'bg-gray-100' : ''
                              }`}
                            >
                              {suggestion.imageUrl && (
                                <div className="flex-shrink-0 w-10 h-10 bg-gray-200 rounded-md overflow-hidden">
                                  <img 
                                    src={suggestion.imageUrl} 
                                    alt={suggestion.text}
                                    className="w-full h-full object-cover"
                                    onError={(e) => {
                                      const target = e.target as HTMLImageElement;
                                      target.style.display = 'none';
                                    }}
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
    </EnvironmentAwareComponent>
  );
}