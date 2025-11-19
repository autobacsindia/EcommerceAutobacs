'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { useAuth } from './AuthContext';

interface CartItem {
  product: {
    _id: string;
    name: string;
    price: number;
    images: string[];
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
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { isAuthenticated } = useAuth();

  // Load cart when user is authenticated
  useEffect(() => {
    if (isAuthenticated) {
      refreshCart();
    } else {
      setCart(null);
    }
  }, [isAuthenticated]);

  const refreshCart = async () => {
    if (!isAuthenticated) return;

    try {
      setIsLoading(true);
      setError(null);

      const response = await apiClient.get(API_ENDPOINTS.CART);

      if (response.success && response.cart) {
        setCart(response.cart);
      }
    } catch (err: any) {
      console.error('Failed to load cart:', err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const addToCart = async (productId: string, quantity: number = 1) => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await apiClient.post(API_ENDPOINTS.CART_ADD, {
        productId,
        quantity,
      });

      if (response.success && response.cart) {
        setCart(response.cart);
      }
    } catch (err: any) {
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

      const response = await apiClient.delete(API_ENDPOINTS.CART_REMOVE(productId));

      if (response.success && response.cart) {
        setCart(response.cart);
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

      const response = await apiClient.put(API_ENDPOINTS.CART_UPDATE(productId), {
        quantity,
      });

      if (response.success && response.cart) {
        setCart(response.cart);
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

      const response = await apiClient.delete(API_ENDPOINTS.CART_CLEAR);

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

  const itemCount = cart?.items?.reduce((count, item) => count + item.quantity, 0) || 0;

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
