'use client';

import { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { useAuth } from './AuthContext';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';

interface WishlistItem {
  product: string;
  addedAt: string;
}

interface WishlistData {
  items: WishlistItem[];
}

interface WishlistResponse {
  wishlist?: WishlistData;
  success: boolean;
  message?: string;
}

interface WishlistContextType {
  wishlistItems: WishlistItem[];
  wishlistCount: number;
  loading: boolean;
  addToWishlist: (productId: string) => Promise<void>;
  removeFromWishlist: (productId: string) => Promise<void>;
  isInWishlist: (productId: string) => boolean;
  fetchWishlist: () => Promise<void>;
}

const WishlistContext = createContext<WishlistContextType | undefined>(undefined);

export function WishlistProvider({ children }: { children: ReactNode }) {
  const [wishlistItems, setWishlistItems] = useState<WishlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const { isAuthenticated } = useAuth();
  
  // Caching and debouncing mechanisms
  const [lastFetched, setLastFetched] = useState<number | null>(null);
  const CACHE_DURATION = 30000; // 30 seconds
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);
  const isRateLimited = useRef(false);
  const rateLimitResetTime = useRef<number | null>(null);

  const wishlistCount = wishlistItems.length;

  const fetchWishlist = async () => {
    // Skip if rate limited and hasn't expired
    if (isRateLimited.current && rateLimitResetTime.current && Date.now() < rateLimitResetTime.current) {
      return;
    }
    
    // Skip if data is fresh
    if (lastFetched && Date.now() - lastFetched < CACHE_DURATION) {
      setLoading(false);
      return;
    }
    
    if (!isAuthenticated) {
      setWishlistItems([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const response: WishlistResponse = await apiClient.get<WishlistResponse>(API_ENDPOINTS.WISHLIST);
      setWishlistItems(response.wishlist?.items || []);
      setLastFetched(Date.now());
      // Reset rate limit status on successful fetch
      isRateLimited.current = false;
      rateLimitResetTime.current = null;
    } catch (error: any) {
      console.error('Failed to fetch wishlist:', error);
      
      // Handle rate limit errors specifically
      if (error.status === 429) {
        isRateLimited.current = true;
        // Set reset time to 1 minute from now if no retry-after header
        rateLimitResetTime.current = Date.now() + 60000;
        
        // Parse retry-after header if available
        // This would require modifying the API client to expose headers
      }
      
      setWishlistItems([]);
    } finally {
      setLoading(false);
    }
  };
  
  // Debounced version of fetchWishlist
  const debouncedFetchWishlist = () => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }
    
    debounceTimer.current = setTimeout(() => {
      fetchWishlist();
    }, 300); // 300ms debounce
  };

  const addToWishlist = async (productId: string): Promise<void> => {
    if (!isAuthenticated) {
      throw new Error('You must be logged in to add items to wishlist');
    }

    try {
      const response: WishlistResponse = await apiClient.post<WishlistResponse>(
        API_ENDPOINTS.WISHLIST_ADD, 
        { productId }
      );
      setWishlistItems(response.wishlist?.items || []);
      // Invalidate cache after successful mutation
      setLastFetched(null);
    } catch (error) {
      throw error;
    }
  };

  const removeFromWishlist = async (productId: string): Promise<void> => {
    if (!isAuthenticated) {
      throw new Error('You must be logged in to remove items from wishlist');
    }

    try {
      const response: WishlistResponse = await apiClient.delete<WishlistResponse>(
        API_ENDPOINTS.WISHLIST_REMOVE(productId)
      );
      setWishlistItems(response.wishlist?.items || []);
      // Invalidate cache after successful mutation
      setLastFetched(null);
    } catch (error) {
      throw error;
    }
  };

  const isInWishlist = (productId: string) => {
    return wishlistItems.some(item => item.product === productId);
  };

  useEffect(() => {
    if (isAuthenticated) {
      debouncedFetchWishlist();
    } else {
      setWishlistItems([]);
      setLoading(false);
    }
  }, [isAuthenticated]);

  // Clean up debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, []);

  return (
    <WishlistContext.Provider
      value={{
        wishlistItems,
        wishlistCount,
        loading,
        addToWishlist,
        removeFromWishlist,
        isInWishlist,
        fetchWishlist
      }}
    >
      {children}
    </WishlistContext.Provider>
  );
}

export function useWishlist() {
  const context = useContext(WishlistContext);
  if (context === undefined) {
    throw new Error('useWishlist must be used within a WishlistProvider');
  }
  return context;
}