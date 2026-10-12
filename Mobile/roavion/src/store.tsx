/**
 * App-wide state: who is signed in, what is in the cart, and the saved vehicle.
 *
 * The cart lives on the SERVER (same cart the website uses), so this holds only
 * the latest server response plus the in-flight flag the UI needs. Nothing here
 * decides a price.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import {
  addToCart as apiAdd,
  fetchCart,
  mergeGuestCart,
  removeFromCart as apiRemove,
  updateQuantity as apiUpdate,
  type Cart,
} from './api/cart';
import { fetchMe, login as apiLogin, logout as apiLogout, register as apiRegister, type Customer } from './api/account';

const GARAGE_KEY = 'roavion.garage';

export interface Garage {
  make: string;
  model?: string;
}

interface AppState {
  /** null = signed out, undefined = still checking on launch. */
  customer: Customer | null | undefined;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string, phone?: string) => Promise<void>;
  signOut: () => Promise<void>;

  cart: Cart;
  cartBusy: boolean;
  refreshCart: () => Promise<void>;
  addItem: (productId: string, quantity?: number, variantId?: string | null) => Promise<void>;
  setQuantity: (productId: string, quantity: number, variantId?: string | null) => Promise<void>;
  removeItem: (productId: string, variantId?: string | null) => Promise<void>;

  garage: Garage | null;
  saveGarage: (garage: Garage | null) => Promise<void>;
}

const EMPTY_CART: Cart = { items: [], totalItems: 0, totalPrice: 0, couponCode: null };

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [customer, setCustomer] = useState<Customer | null | undefined>(undefined);
  const [cart, setCart] = useState<Cart>(EMPTY_CART);
  const [cartBusy, setCartBusy] = useState(false);
  const [garage, setGarage] = useState<Garage | null>(null);

  const refreshCart = useCallback(async () => {
    try {
      setCart(await fetchCart());
    } catch {
      // Offline or a blip: keep showing the last known cart rather than emptying it.
    }
  }, []);

  // On launch: restore the session, the cart and the saved vehicle together.
  useEffect(() => {
    (async () => {
      const [me, saved] = await Promise.all([
        fetchMe(),
        SecureStore.getItemAsync(GARAGE_KEY).catch(() => null),
      ]);
      setCustomer(me);
      if (saved) {
        try {
          setGarage(JSON.parse(saved) as Garage);
        } catch {
          /* corrupt value — ignore it */
        }
      }
      await refreshCart();
    })();
  }, [refreshCart]);

  const signIn = useCallback(async (email: string, password: string) => {
    const me = await apiLogin(email, password);
    setCustomer(me);
    // Anything added before signing in should follow them into their account.
    await mergeGuestCart().catch(() => {});
    await refreshCart();
  }, [refreshCart]);

  const signUp = useCallback(async (name: string, email: string, password: string, phone?: string) => {
    const me = await apiRegister(name, email, password, phone);
    setCustomer(me);
    await mergeGuestCart().catch(() => {});
    await refreshCart();
  }, [refreshCart]);

  const signOut = useCallback(async () => {
    await apiLogout();
    setCustomer(null);
    setCart(EMPTY_CART);
  }, []);

  /** Every cart write returns the new server cart, so state is never guessed. */
  const run = useCallback(async (action: () => Promise<Cart>) => {
    setCartBusy(true);
    try {
      setCart(await action());
    } finally {
      setCartBusy(false);
    }
  }, []);

  const addItem = useCallback(
    (productId: string, quantity = 1, variantId?: string | null) => run(() => apiAdd(productId, quantity, variantId)),
    [run],
  );

  const setQuantity = useCallback(
    (productId: string, quantity: number, variantId?: string | null) =>
      run(() => (quantity < 1 ? apiRemove(productId, variantId) : apiUpdate(productId, quantity, variantId))),
    [run],
  );

  const removeItem = useCallback(
    (productId: string, variantId?: string | null) => run(() => apiRemove(productId, variantId)),
    [run],
  );

  const saveGarage = useCallback(async (next: Garage | null) => {
    setGarage(next);
    try {
      if (next) await SecureStore.setItemAsync(GARAGE_KEY, JSON.stringify(next));
      else await SecureStore.deleteItemAsync(GARAGE_KEY);
    } catch {
      /* remembering the car is a convenience, never a blocker */
    }
  }, []);

  const value = useMemo<AppState>(
    () => ({
      customer, signIn, signUp, signOut,
      cart, cartBusy, refreshCart, addItem, setQuantity, removeItem,
      garage, saveGarage,
    }),
    [customer, signIn, signUp, signOut, cart, cartBusy, refreshCart, addItem, setQuantity, removeItem, garage, saveGarage],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
