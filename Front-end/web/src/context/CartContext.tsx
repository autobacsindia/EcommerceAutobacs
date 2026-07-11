'use client';

import type { StockStatus } from '@/lib/stock';
import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import apiClient from '@/lib/api';
import { AUTH_LOGIN_EVENT } from '@/lib/api-client';
import { API_ENDPOINTS } from '@/lib/constants';
import { useAuth } from './AuthContext';
import { ProductImage } from '@/lib/types';
import { trackAddToCart, trackRemoveFromCart } from '@/lib/analytics';

interface CartItem {
  product: {
    _id: string;
    name: string;
    price: number;
    images: ProductImage[] | string;
    stock: StockStatus;
  };
  quantity: number;
}

interface Cart {
  _id: string;
  items: CartItem[];
  total: number;
  /** Coupon code the shopper applied. The discount itself is always priced server-side. */
  couponCode: string | null;
}

interface CartContextType {
  cart: Cart | null;
  itemCount: number;
  isLoading: boolean;
  error: string | null;
  addToCart: (productId: string, quantity?: number) => Promise<void>;
  removeFromCart: (productId: string) => Promise<void>;
  updateQuantity: (productId: string, quantity: number) => Promise<void>;
  clearCart: () => Promise<void>;
  refreshCart: () => Promise<void>;
  applyCoupon: (code: string) => Promise<void>;
  removeCoupon: () => Promise<void>;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<Cart | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [isMounted, setIsMounted] = useState(false);

  // Tracks the AbortController for the current in-flight cart fetch so that a
  // new fetch triggered by an auth state change cancels the previous one before
  // it can resolve out of order and overwrite fresher cart state.
  const cartAbortRef = useRef<AbortController | null>(null);

  const refreshCart = useCallback(async () => {
    // Cancel any previous in-flight fetch before starting a new one so that
    // rapid auth state changes (login, session revalidation, logout) never
    // leave two concurrent requests that could resolve out of order.
    cartAbortRef.current?.abort();
    const controller = new AbortController();
    cartAbortRef.current = controller;
    const { signal } = controller;

    try {
      setIsLoading(true);
      setError(null);

      const response: any = await apiClient.get(API_ENDPOINTS.CART, { signal });

      if (response.success && response.cart) {
        const cartData: Cart = {
          _id: response.cart._id,
          items: response.cart.items.map((item: any) => ({
            product: {
              _id: item.product._id,
              name: item.product.name,
              price: item.product.price,
              images: Array.isArray(item.product.images) ? item.product.images : [],
              stock: item.product.stock
            },
            quantity: item.quantity
          })),
          total: response.cart.totalPrice || response.cart.total || 0,
          couponCode: response.cart.couponCode ?? null
        };
        setCart(cartData);
      } else {
        setCart(null);
      }
    } catch (err: any) {
      // Request was superseded by a newer fetch — discard silently.
      if (err.name === 'AbortError') return;

      console.error('Failed to load cart:', err);
      if (err.status === 429) {
        setError('Too many requests. Please wait a moment before trying again.');
        return;
      }
      setError(err.message);
      setCart(null);
    } finally {
      // Only clear the loading flag if this request was not superseded.
      // If it was aborted, a newer fetch is already running and will clear
      // it when it finishes.
      if (!signal.aborted) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Cancel any in-flight cart fetch on unmount.
  useEffect(() => {
    return () => { cartAbortRef.current?.abort(); };
  }, []);

  // Load cart once mounted and auth has settled.
  // Always fetch — backend resolves auth vs guest via cookie/x-session-id header.
  useEffect(() => {
    if (!isMounted || authLoading) return;
    refreshCart();
  }, [isAuthenticated, isMounted, authLoading, refreshCart]);

  // On a fresh login/register/social auth, merge the guest (session) cart into
  // the now-authenticated user's cart, then refresh so the badge reflects the
  // merged items. The merge endpoint claims the guest cart atomically, so this
  // is safe to fire even if the event lands more than once.
  useEffect(() => {
    const onLogin = async () => {
      try {
        await apiClient.post(API_ENDPOINTS.CART_MERGE, {});
      } catch (err) {
        // Non-fatal: even if the merge fails, still refresh to show the user's
        // server cart. The guest items remain claimable until a merge succeeds.
        console.error('Cart merge after login failed:', err);
      } finally {
        refreshCart();
      }
    };
    window.addEventListener(AUTH_LOGIN_EVENT, onLogin);
    return () => window.removeEventListener(AUTH_LOGIN_EVENT, onLogin);
  }, [refreshCart]);

  const addToCart = async (productId: string, quantity: number = 1) => {
    const previousCart = cart;

    // Optimistic update: immediately increment quantity if item already in cart
    if (cart) {
      const existingItem = cart.items.find(item => item.product._id === productId);
      if (existingItem) {
        setCart({
          ...cart,
          items: cart.items.map(item =>
            item.product._id === productId
              ? { ...item, quantity: item.quantity + quantity }
              : item
          ),
        });
      }
    }

    try {
      setIsLoading(true);
      setError(null);

      const response: any = await apiClient.post(API_ENDPOINTS.CART_ADD, {
        productId,
        quantity,
      });

      if (response.success && response.cart) {
        const cartData: Cart = {
          _id: response.cart._id,
          items: response.cart.items.map((item: any) => ({
            product: {
              _id: item.product._id,
              name: item.product.name,
              price: item.product.price,
              images: Array.isArray(item.product.images) ? item.product.images : [],
              stock: item.product.stock
            },
            quantity: item.quantity
          })),
          total: response.cart.totalPrice || response.cart.total || 0,
          couponCode: response.cart.couponCode ?? null
        };

        setCart(cartData);

        // Analytics: add_to_cart (ADR-005)
        const added = cartData.items.find(i => i.product._id === productId);
        if (added) {
          trackAddToCart({ id: productId, name: added.product.name, price: added.product.price, quantity });
        }
      } else {
        setCart(previousCart);
        throw new Error(response.message || 'Failed to add to cart');
      }
    } catch (err: any) {
      // Roll the optimistic update back to the last known-good cart. The cart
      // API supports guests via the x-session-id header (optionalAuth), so a
      // failure here is a real error — surface it rather than swallowing it,
      // otherwise callers show a false "Added to cart" toast while the badge
      // never updates.
      setCart(previousCart);

      const errorMessage = err.message || 'Failed to add item to cart';
      setError(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };
  
  const removeFromCart = async (productId: string) => {
    // Capture item details before removal for analytics.
    const removed = cart?.items.find(i => i.product._id === productId);
    const previousCart = cart;

    // Optimistic update: drop the item immediately so the badge/list reflect the
    // tap before the server round-trip. Rolled back below if the request fails.
    if (cart) {
      setCart({
        ...cart,
        items: cart.items.filter(item => item.product._id !== productId),
      });
    }

    try {
      setIsLoading(true);
      setError(null);

      const response: any = await apiClient.delete(API_ENDPOINTS.CART_REMOVE(productId));

      if (response.success && response.cart) {
        // Analytics: remove_from_cart (ADR-005)
        if (removed) {
          trackRemoveFromCart({ id: productId, name: removed.product.name, price: removed.product.price, quantity: removed.quantity });
        }

        // Ensure consistent cart data structure
        const cartData: Cart = {
          _id: response.cart._id,
          items: response.cart.items.map((item: any) => ({
            product: {
              _id: item.product._id,
              name: item.product.name,
              price: item.product.price,
              images: Array.isArray(item.product.images) ? item.product.images : [],
              stock: item.product.stock
            },
            quantity: item.quantity
          })),
          total: response.cart.totalPrice || response.cart.total || 0,
          couponCode: response.cart.couponCode ?? null
        };
        
        setCart(cartData);
      }
    } catch (err: any) {
      // Roll the optimistic removal back to the last known-good cart.
      setCart(previousCart);

      const errorMessage = err.message || 'Failed to remove item from cart';
      setError(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const updateQuantity = async (productId: string, quantity: number) => {
    const previousCart = cart;

    // Optimistic update: reflect the new quantity immediately. Rolled back below
    // if the request fails. Guard against non-positive values (the cart UI uses
    // removeFromCart for zero) so the badge count never goes negative.
    if (cart && quantity > 0) {
      setCart({
        ...cart,
        items: cart.items.map(item =>
          item.product._id === productId ? { ...item, quantity } : item
        ),
      });
    }

    try {
      setIsLoading(true);
      setError(null);

      const response: any = await apiClient.put(API_ENDPOINTS.CART_UPDATE(productId), {
        quantity,
      });
      
      if (response.success && response.cart) {
        // Ensure consistent cart data structure
        const cartData: Cart = {
          _id: response.cart._id,
          items: response.cart.items.map((item: any) => ({
            product: {
              _id: item.product._id,
              name: item.product.name,
              price: item.product.price,
              images: Array.isArray(item.product.images) ? item.product.images : [],
              stock: item.product.stock
            },
            quantity: item.quantity
          })),
          total: response.cart.totalPrice || response.cart.total || 0,
          couponCode: response.cart.couponCode ?? null
        };
        
        setCart(cartData);
      }
    } catch (err: any) {
      // Roll the optimistic quantity change back to the last known-good cart.
      setCart(previousCart);

      const errorMessage = err.message || 'Failed to update cart';
      setError(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const clearCart = async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      const response: any = await apiClient.delete(API_ENDPOINTS.CART_CLEAR);
      
      if (response.success) {
        setCart(null);
      }
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to clear cart';
      setError(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };
  
  // Coupon lives on the cart so it survives the trip to checkout. The server validates
  // the code against the cart before storing it, and rejects with a buyer-facing reason
  // (expired, min cart value, login required, …) which we surface to the caller.
  const applyCoupon = async (code: string) => {
    setError(null);
    const response: any = await apiClient.put(API_ENDPOINTS.CART_COUPON, { code });
    if (response.success) await refreshCart();
  };

  const removeCoupon = async () => {
    setError(null);
    const response: any = await apiClient.delete(API_ENDPOINTS.CART_COUPON);
    if (response.success) await refreshCart();
  };

  // Calculate item count consistently
  const itemCount = cart?.items?.reduce((count, item) => count + item.quantity, 0) || 0;
  
  // Ensure consistent value object structure
  const value: CartContextType = {
    cart,
    itemCount,
    isLoading,
    error,
    addToCart,
    removeFromCart,
    updateQuantity,
    clearCart,
    refreshCart,
    applyCoupon,
    removeCoupon,
  };
  
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);
  if (context === undefined) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return context;
}

export default CartContext;