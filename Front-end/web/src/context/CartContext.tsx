'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { useAuth } from './AuthContext';
import { ProductImage } from '@/lib/types';

interface CartItem {
  product: {
    _id: string;
    name: string;
    price: number;
    images: ProductImage[] | string;
    stock: number;
  };
  quantity: number;
}

interface Cart {
  _id: string;
  items: CartItem[];
  total: number;
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
}

const CartContext = createContext<CartContextType | undefined>(undefined);

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<Cart | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Load cart once mounted and auth has settled.
  // Always fetch — backend resolves auth vs guest via cookie/x-session-id header.
  useEffect(() => {
    if (!isMounted || authLoading) return;
    refreshCart();
  }, [isAuthenticated, isMounted, authLoading]);
  
  // Enhanced refreshCart with better error handling and consistency
  const refreshCart = async () => {
    try {
      setIsLoading(true);
      setError(null);
      console.log('Refreshing cart...');
      
      const response: any = await apiClient.get(API_ENDPOINTS.CART);
      console.log('Cart response:', response);
      
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
          total: response.cart.totalPrice || response.cart.total || 0
        };
        
        setCart(cartData);
      } else {
        // Clear cart on invalid response
        setCart(null);
      }
    } catch (err: any) {
      console.error('Failed to load cart:', err);
      // Handle rate limit errors specifically
      if (err.status === 429) {
        setError('Too many requests. Please wait a moment before trying again.');
        // Don't clear the cart on rate limit errors
        return;
      }
      setError(err.message);
      // Ensure consistent state on error
      setCart(null);
    } finally {
      setIsLoading(false);
    }
  };
  
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
          total: response.cart.totalPrice || response.cart.total || 0
        };

        setCart(cartData);
      } else {
        setCart(previousCart);
        throw new Error(response.message || 'Failed to add to cart');
      }
    } catch (err: any) {
      setCart(previousCart);

      // Handle "Not authorized" or "Route not found" errors for guest users gracefully
      // Backend has a middleware quirk where protect sends 401 but Express continues to 404 handler
      if ((err.status === 401 || err.status === 404) &&
          (err.message?.includes('Not authorized') ||
           err.message?.includes('Route not found') ||
           err.message?.includes('no token'))) {
        console.debug('Guest user attempted cart add - this is expected (backend middleware quirk)');
        return;
      }

      const errorMessage = err.message || 'Failed to add item to cart';
      setError(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };
  
  const removeFromCart = async (productId: string) => {
    try {
      setIsLoading(true);
      setError(null);
      
      const response: any = await apiClient.delete(API_ENDPOINTS.CART_REMOVE(productId));
      
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
          total: response.cart.totalPrice || response.cart.total || 0
        };
        
        setCart(cartData);
      }
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to remove item from cart';
      setError(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };
  
  const updateQuantity = async (productId: string, quantity: number) => {
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
          total: response.cart.totalPrice || response.cart.total || 0
        };
        
        setCart(cartData);
      }
    } catch (err: any) {
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