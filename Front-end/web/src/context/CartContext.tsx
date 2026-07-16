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
  // For variable products: the chosen variant's id + label. A product+variant
  // pair is a distinct cart line, so both are needed to identify/mutate a line.
  variantId?: string | null;
  variantLabel?: string | null;
  // Authoritative per-unit line price (variant price for variable products).
  // Prefer this over product.price, which for variable products is only the range min.
  price?: number;
  quantity: number;
}

// Two cart lines are the same only when product AND variant match.
const isSameLine = (item: CartItem, productId: string, variantId?: string | null) =>
  item.product._id === productId && (item.variantId ?? null) === (variantId ?? null);

// Normalize a server cart payload into our client Cart shape (variant-aware).
const mapServerCart = (serverCart: any): Cart => ({
  _id: serverCart._id,
  items: (serverCart.items ?? []).map((item: any) => ({
    product: {
      _id: item.product._id,
      name: item.product.name,
      price: item.product.price,
      images: Array.isArray(item.product.images) ? item.product.images : [],
      stock: item.product.stock,
    },
    variantId: item.variantId ?? null,
    variantLabel: item.variantLabel ?? null,
    // The line price is authoritative (variant price for variable products);
    // the populated product.price is only the parent/range min.
    price: item.price,
    quantity: item.quantity,
  })),
  total: serverCart.totalPrice || serverCart.total || 0,
  couponCode: serverCart.couponCode ?? null,
});

/**
 * Minimal product fields a caller can hand to `addToCart` so the optimistic
 * line for a *first* add renders with real name/price/image while the server
 * confirms. Optional — without it the item still counts instantly via a
 * lightweight placeholder line that the server response then replaces.
 */
export type OptimisticProduct = {
  name: string;
  price: number;
  images: ProductImage[] | string;
  stock: StockStatus;
  /** For variable products: the selected variant's label, shown on the optimistic line. */
  variantLabel?: string | null;
};

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
  addToCart: (productId: string, quantity?: number, snapshot?: OptimisticProduct, variantId?: string | null) => Promise<void>;
  removeFromCart: (productId: string, variantId?: string | null) => Promise<void>;
  updateQuantity: (productId: string, quantity: number, variantId?: string | null) => Promise<void>;
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
        setCart(mapServerCart(response.cart));
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

  const addToCart = async (productId: string, quantity: number = 1, snapshot?: OptimisticProduct, variantId?: string | null) => {
    const previousCart = cart;
    const vId = variantId ?? null;

    // Optimistic update: reflect the add immediately so the cart badge responds on
    // tap instead of after the ~1s server round-trip. Lines are keyed by product +
    // variant, so adding a second model of the same product appends a new line.
    setCart(prev => {
      const base: Cart = prev ?? { _id: 'optimistic', items: [], total: 0, couponCode: null };
      const existingItem = base.items.find(item => isSameLine(item, productId, vId));
      if (existingItem) {
        return {
          ...base,
          items: base.items.map(item =>
            isSameLine(item, productId, vId)
              ? { ...item, quantity: item.quantity + quantity }
              : item
          ),
        };
      }
      return {
        ...base,
        items: [
          ...base.items,
          {
            product: {
              _id: productId,
              name: snapshot?.name ?? '',
              price: snapshot?.price ?? 0,
              images: snapshot?.images ?? [],
              stock: snapshot?.stock ?? 'in',
            },
            variantId: vId,
            variantLabel: snapshot?.variantLabel ?? null,
            price: snapshot?.price ?? 0,
            quantity,
          },
        ],
      };
    });

    try {
      setIsLoading(true);
      setError(null);

      const response: any = await apiClient.post(API_ENDPOINTS.CART_ADD, {
        productId,
        quantity,
        ...(vId && { variantId: vId }),
      });

      if (response.success && response.cart) {
        const cartData = mapServerCart(response.cart);
        setCart(cartData);

        // Analytics: add_to_cart (ADR-005)
        const added = cartData.items.find(i => isSameLine(i, productId, vId));
        if (added) {
          trackAddToCart({ id: productId, name: added.product.name, price: added.price ?? added.product.price, quantity });
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
  
  const removeFromCart = async (productId: string, variantId?: string | null) => {
    const vId = variantId ?? null;
    // Capture item details before removal for analytics.
    const removed = cart?.items.find(i => isSameLine(i, productId, vId));
    const previousCart = cart;

    // Optimistic update: drop the exact line (product + variant) immediately.
    if (cart) {
      setCart({
        ...cart,
        items: cart.items.filter(item => !isSameLine(item, productId, vId)),
      });
    }

    try {
      setIsLoading(true);
      setError(null);

      const url = API_ENDPOINTS.CART_REMOVE(productId) + (vId ? `?variantId=${encodeURIComponent(vId)}` : '');
      const response: any = await apiClient.delete(url);

      if (response.success && response.cart) {
        // Analytics: remove_from_cart (ADR-005)
        if (removed) {
          trackRemoveFromCart({ id: productId, name: removed.product.name, price: removed.price ?? removed.product.price, quantity: removed.quantity });
        }

        setCart(mapServerCart(response.cart));
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

  const updateQuantity = async (productId: string, quantity: number, variantId?: string | null) => {
    const previousCart = cart;
    const vId = variantId ?? null;

    // Optimistic update: reflect the new quantity on the exact line (product +
    // variant). Guard against non-positive values (the cart UI uses removeFromCart
    // for zero) so the badge count never goes negative.
    if (cart && quantity > 0) {
      setCart({
        ...cart,
        items: cart.items.map(item =>
          isSameLine(item, productId, vId) ? { ...item, quantity } : item
        ),
      });
    }

    try {
      setIsLoading(true);
      setError(null);

      const response: any = await apiClient.put(API_ENDPOINTS.CART_UPDATE(productId), {
        quantity,
        ...(vId && { variantId: vId }),
      });

      if (response.success && response.cart) {
        setCart(mapServerCart(response.cart));
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