'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import useIsMounted from '@/lib/hooks/useIsMounted';
import { generateDeterministicId } from '@/lib/utils/idGenerator';
import EnvironmentAwareComponent from './EnvironmentAwareComponent';
import { Search } from 'lucide-react';

// Define a suggestion type with more information
interface Suggestion {
  id: string;
  text: string;
  type: 'product' | 'brand' | 'category';
  category?: string;
  imageUrl?: string;
}

export default function SearchSuggestions() {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const isMounted = useIsMounted();
  const router = useRouter();
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Generate deterministic IDs for list items
  const suggestionIds = suggestions.map((_, index) => 
    generateDeterministicId(`suggestion-${index}`)
  );

  // Handle click outside to close suggestions
  useEffect(() => {
    if (!isMounted) return; // Don't attach listener until mounted

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
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
      setSuggestions([]);
      setIsOpen(false);
      return;
    }

    // Clear previous timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Set new timeout
    timeoutRef.current = setTimeout(async () => {
      setIsLoading(true);
      try {
        // Enhanced API endpoint that returns richer suggestion data
        const response = await fetch(`/api/products/suggestions?q=${encodeURIComponent(query)}&limit=8`);
        const data = await response.json();
        if (data.success) {
          setSuggestions(data.suggestions || []);
          setIsOpen((data.suggestions || []).length > 0);
        }
      } catch (error) {
        console.error('Error fetching suggestions:', error);
        setSuggestions([]);
        setIsOpen(false);
      } finally {
        setIsLoading(false);
      }
    }, 200); // Reduced debounce time for better responsiveness

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [query, isMounted]);

  const handleSearch = (searchQuery: string = query) => {
    if (searchQuery.trim()) {
      router.push(`/search?search=${encodeURIComponent(searchQuery.trim())}`);
      setIsOpen(false);
      setQuery('');
    }
  };

  const handleSuggestionClick = (suggestion: Suggestion) => {
    setQuery(suggestion.text);
    handleSearch(suggestion.text);
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
        <div className="flex">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleSearch();
              }
            }}
            onFocus={() => query.length >= 2 && suggestions.length > 0 && setIsOpen(true)}
            placeholder="Search products, brands, categories..."
            className="w-full px-4 py-2 border border-gray-300 rounded-l-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            // Use deterministic ID
            id={generateDeterministicId('search-input')}
          />
          <button 
            onClick={() => handleSearch()}
            className="bg-blue-600 text-white px-4 py-2 rounded-r-md hover:bg-blue-700 transition-colors"
            // Use deterministic ID
            id={generateDeterministicId('search-button')}
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
            ) : suggestions.length > 0 ? (
              <ul className="py-1 max-h-96 overflow-y-auto">
                {suggestions.map((suggestion, index) => (
                  <li key={suggestionIds[index]}>
                    <button
                      onClick={() => handleSuggestionClick(suggestion)}
                      className="w-full text-left px-4 py-3 hover:bg-gray-100 focus:bg-gray-100 focus:outline-none flex items-center gap-3"
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
                ))}
              </ul>
            ) : query.length >= 2 ? (
              <div className="px-4 py-3 text-gray-500">
                No suggestions found for "{query}"
              </div>
            ) : null}
          </div>
        )}
      </div>
    </EnvironmentAwareComponent>
  );
}