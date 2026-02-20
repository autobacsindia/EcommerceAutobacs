'use client';

import { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { useAuth } from './AuthContext';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';

interface WishlistItem {
  product: string;
  addedAt: string;
  notes?: string;
}

interface Wishlist {
  _id: string;
  name: string;
  description?: string;
  items: WishlistItem[];
  privacy?: string;
  createdAt: string;
  updatedAt: string;
}

interface WishlistData {
  items: WishlistItem[];
}

interface WishlistResponse {
  wishlist?: WishlistData;
  wishlists?: Wishlist[];
  success: boolean;
  message?: string;
  count?: number;
}

interface WishlistContextType {
  wishlistItems: WishlistItem[];
  wishlistCount: number;
  loading: boolean;
  addToWishlist: (productId: string) => Promise<void>;
  removeFromWishlist: (productId: string) => Promise<void>;
  isInWishlist: (productId: string) => boolean;
  fetchWishlist: () => Promise<void>;
  wishlists: Wishlist[];
  activeWishlist: Wishlist | null;
  createWishlist: (name: string, description?: string) => Promise<Wishlist>;
  setActiveWishlist: (wishlistId: string) => Promise<void>;
}

const WishlistContext = createContext<WishlistContextType | undefined>(undefined);

export function WishlistProvider({ children }: { children: ReactNode }) {
  const [wishlistItems, setWishlistItems] = useState<WishlistItem[]>([]);
  const [wishlists, setWishlists] = useState<Wishlist[]>([]);
  const [activeWishlist, setActiveWishlistState] = useState<Wishlist | null>(null);
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
      setWishlists([]);
      setActiveWishlistState(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const response: WishlistResponse = await apiClient.get<WishlistResponse>(API_ENDPOINTS.WISHLIST);
      
      // Set all wishlists
      const userWishlists = response.wishlists || [];
      setWishlists(userWishlists);
      
      // Set active wishlist (first one or null if none exist)
      const firstWishlist = userWishlists.length > 0 ? userWishlists[0] : null;
      setActiveWishlistState(firstWishlist);
      
      // Set items from active wishlist
      setWishlistItems(firstWishlist?.items || []);
      
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
      setWishlists([]);
      setActiveWishlistState(null);
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

    // Validate productId
    if (!productId || typeof productId !== 'string' || productId.trim() === '') {
      throw new Error('Invalid product ID provided');
    }
    
    // Ensure productId is a valid format (MongoDB ObjectId is 24 hex characters)
    if (productId.length !== 24 || !/^[0-9a-fA-F]{24}$/.test(productId)) {
      console.warn('Product ID may not be in valid MongoDB ObjectId format:', productId);
    }

    // Ensure we have an active wishlist
    let wishlistToUse = activeWishlist;
    if (!wishlistToUse) {
      // Try to fetch wishlists first
      await fetchWishlist();
      
      // Get the updated active wishlist after fetch
      // We need to get the current value from state, not the previous reference
      wishlistToUse = activeWishlist;
      
      // If still no wishlist, create a default one
      if (!wishlistToUse) {
        try {
          wishlistToUse = await createWishlist('My Wishlist', 'My default wishlist');
          setActiveWishlistState(wishlistToUse);
        } catch (createError) {
          console.error('Failed to create default wishlist:', createError);
          throw new Error('Unable to add item to wishlist. Please try again.');
        }
      }
    }
    
    // Ensure we have a valid wishlist with an ID
    if (!wishlistToUse || !wishlistToUse._id) {
      console.error('No valid wishlist found:', { wishlistToUse, activeWishlist, wishlists });
      throw new Error('Unable to add item to wishlist. No valid wishlist found.');
    }

    try {
      // Validate that we have a valid wishlist ID
      if (!wishlistToUse || !wishlistToUse._id) {
        throw new Error('Invalid wishlist ID');
      }
      
      // Validate that we have a valid product ID
      if (!productId || typeof productId !== 'string' || productId.trim() === '') {
        throw new Error('Invalid product ID');
      }
      
      // Log the request for debugging
      console.log('Adding item to wishlist:', { wishlistId: wishlistToUse._id, productId });
      
      // Validate productId format before sending
      if (!productId || typeof productId !== 'string') {
        console.error('Invalid productId format:', productId);
        throw new Error('Invalid product ID format');
      }
      
      // Check if productId is a valid MongoDB ObjectId
      if (productId.length !== 24 || !/^[0-9a-fA-F]{24}$/.test(productId)) {
        console.warn('ProductId may not be a valid MongoDB ObjectId:', productId);
        // Still proceed with the request but log the warning
      }
      
      console.log('Sending request to API:', {
        url: API_ENDPOINTS.WISHLIST_ADD_ITEM(wishlistToUse._id),
        method: 'POST',
        body: { productId }
      });
      
      const response: WishlistResponse = await apiClient.post<WishlistResponse>(
        API_ENDPOINTS.WISHLIST_ADD_ITEM(wishlistToUse._id), 
        { productId }
      );
      
      console.log('Received response from API:', response);
      
      // Update the active wishlist and items
      if (response.wishlist) {
        const updatedWishlist = {
          ...wishlistToUse,
          items: response.wishlist.items
        };
        setActiveWishlistState(updatedWishlist);
        setWishlistItems(response.wishlist.items);
        
        // Update the wishlists array
        setWishlists(prev => prev.map(w => 
          w._id === wishlistToUse._id ? updatedWishlist : w
        ));
      }
      
      // Invalidate cache after successful mutation
      setLastFetched(null);
    } catch (error: any) {
      // Log more detailed error information for debugging
      console.error('Failed to add to wishlist - detailed error info:', {
        error,
        errorName: error?.name,
        errorMessage: error?.message,
        errorStatus: error?.status,
        errorStack: error?.stack,
        productId,
        wishlistId: wishlistToUse?._id,
        isAuthenticated,
        wishlistToUse
      });
      
      // Check if it's the "already in wishlist" error
      if (error.message && error.message.includes('already in wishlist')) {
        // If product is already in wishlist, remove it
        try {
          await removeFromWishlist(productId);
          // Return a special indicator that we removed the item
          throw new Error('ITEM_REMOVED');
        } catch (removeError: any) {
          if (removeError.message !== 'ITEM_REMOVED') {
            console.error('Failed to remove from wishlist:', removeError);
            throw removeError;
          }
          // If it's our special indicator, rethrow it
          throw removeError;
        }
      } else {
        // Provide more specific error messages based on error type
        if (error.status === 400) {
          // This is likely a validation error
          const validationMessage = error.message || 'Invalid request data';
          // Avoid duplicating "Validation Error" in the message
          if (validationMessage.includes('Validation Error')) {
            throw new Error(validationMessage);
          } else if (validationMessage === 'Validation Error' || validationMessage === 'Validation error') {
            // If we only have a generic validation error, provide a more descriptive message
            throw new Error('Validation failed. Please check your input and try again.');
          } else {
            throw new Error(`Validation Error: ${validationMessage}`);
          }
        } else if (error.status === 404) {
          throw new Error('Wishlist or product not found');
        } else if (error.status === 409) {
          throw new Error('Product already in wishlist');
        } else if (error instanceof Error) {
          // Pass through the original error message
          throw error;
        } else {
          // Handle any other error types
          throw new Error('Failed to add item to wishlist. Please try again.');
        }
      }
    }
  };

  const removeFromWishlist = async (productId: string): Promise<void> => {
    if (!isAuthenticated) {
      throw new Error('You must be logged in to remove items from wishlist');
    }

    // Ensure we have an active wishlist
    if (!activeWishlist) {
      throw new Error('No active wishlist found');
    }

    try {
      const response: WishlistResponse = await apiClient.delete<WishlistResponse>(
        API_ENDPOINTS.WISHLIST_REMOVE_ITEM(activeWishlist._id, productId)
      );
      
      // Update the active wishlist and items
      if (response.wishlist) {
        const updatedWishlist = {
          ...activeWishlist,
          items: response.wishlist.items
        };
        setActiveWishlistState(updatedWishlist);
        setWishlistItems(response.wishlist.items);
        
        // Update the wishlists array
        setWishlists(prev => prev.map(w => 
          w._id === activeWishlist._id ? updatedWishlist : w
        ));
      }
      
      // Invalidate cache after successful mutation
      setLastFetched(null);
    } catch (error) {
      throw error;
    }
  };

  const isInWishlist = (productId: string) => {
    // Check if the wishlist items contain a product with the given ID
    // The item.product could be either:
    // 1. A string (product ID) - older format
    // 2. An object with _id property - populated format
    const result = wishlistItems.some(item => {
      if (typeof item.product === 'string') {
        return item.product === productId;
      } else if (typeof item.product === 'object' && item.product !== null) {
        return (item.product as any)._id === productId;
      }
      return false;
    });
    
    return result;
  };

  const createWishlist = async (name: string, description?: string): Promise<Wishlist> => {
    if (!isAuthenticated) {
      throw new Error('You must be logged in to create a wishlist');
    }
    
    // Log the wishlist creation attempt
    console.log('Creating wishlist:', { name, description });

    try {
      const response: WishlistResponse = await apiClient.post<WishlistResponse>(
        API_ENDPOINTS.WISHLIST,
        { name, description }
      );
      
      // The backend returns the full wishlist object directly
      // Check if response is the wishlist object itself or nested
      const wishlistData = response.wishlist || response as any;
      
      if (wishlistData && wishlistData._id) {
        const newWishlist: Wishlist = {
          _id: wishlistData._id,
          name: wishlistData.name || name,
          description: wishlistData.description || description,
          items: wishlistData.items || [],
          privacy: wishlistData.privacy,
          createdAt: wishlistData.createdAt || new Date().toISOString(),
          updatedAt: wishlistData.updatedAt || new Date().toISOString()
        };
        
        // Update wishlists array
        setWishlists(prev => [...prev, newWishlist]);
        
        // If this is the first wishlist, set it as active
        if (wishlists.length === 0) {
          setActiveWishlistState(newWishlist);
          setWishlistItems(newWishlist.items);
        }
        
        return newWishlist;
      }
      
      throw new Error('Failed to create wishlist: No wishlist data returned');
    } catch (error: any) {
      console.error('Failed to create wishlist:', error);
      
      // Provide more specific error messages
      if (error.status === 400) {
        const validationMessage = error.message || 'Invalid wishlist data';
        throw new Error(`Validation Error: ${validationMessage}`);
      } else if (error.status === 409) {
        throw new Error('A wishlist with this name already exists');
      } else {
        throw new Error('Failed to create wishlist. Please try again.');
      }
    }
  };

  const setActiveWishlist = async (wishlistId: string): Promise<void> => {
    const wishlist = wishlists.find(w => w._id === wishlistId);
    if (wishlist) {
      setActiveWishlistState(wishlist);
      setWishlistItems(wishlist.items);
    } else {
      throw new Error('Wishlist not found');
    }
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
        fetchWishlist,
        wishlists,
        activeWishlist,
        createWishlist,
        setActiveWishlist
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