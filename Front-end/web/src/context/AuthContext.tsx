'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import apiClient from '@/lib/api';
import { API_ENDPOINTS, AUTH_ERROR_MESSAGES } from '@/lib/constants';
import { identifyUser, resetAnalytics, trackSignUp } from '@/lib/analytics';

interface User {
  _id: string;
  name: string;
  email: string;
  role: 'customer' | 'admin';
  sessionVersion: number;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  checkAuth: () => Promise<void>;
  hydrateFromExchange: (rawUser: any) => void;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const CACHE_KEY = 'auth_check';

// Admin sessions are validated more frequently — a role change or ban must
// propagate quickly. Customer sessions tolerate slightly more staleness.
const CACHE_TTL: Record<string, number> = {
  admin:    60 * 1000,       // 60 seconds
  customer: 2 * 60 * 1000,  // 2 minutes
};
const DEFAULT_TTL = 60 * 1000;

interface CachedAuth {
  user: User | null;
  sessionVersion: number;
  timestamp: number;
}

function readCache(): CachedAuth | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CachedAuth;
  } catch {
    return null;
  }
}

function writeCache(user: User | null, sessionVersion: number) {
  try {
    const entry: CachedAuth = { user, sessionVersion, timestamp: Date.now() };
    localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    // localStorage unavailable (private browsing, storage full) — non-fatal
  }
}

function clearCache() {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch { /* non-fatal */ }
}

function isCacheValid(cached: CachedAuth): boolean {
  const ttl = cached.user?.role
    ? (CACHE_TTL[cached.user.role] ?? DEFAULT_TTL)
    : DEFAULT_TTL;
  return Date.now() - cached.timestamp < ttl;
}

function normalizeUser(raw: any): User {
  return {
    _id:            raw._id || raw.id,
    name:           raw.name,
    email:          raw.email,
    role:           raw.role,
    sessionVersion: raw.sessionVersion ?? 0,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]       = useState<User | null>(null);
  const [token, setToken]     = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);

  // Tracks the AbortController for the current synchronous auth fetch so it can
  // be cancelled on unmount or superseded by the isCheckingAuthRef guard.
  const checkAbortRef      = useRef<AbortController | null>(null);
  // Tracks the AbortController for the current background revalidation so rapid
  // navigation doesn't leave multiple concurrent revalidations in flight.
  const revalidateAbortRef = useRef<AbortController | null>(null);
  // Prevents re-entrant synchronous auth checks. A second concurrent call to
  // checkAuth returns early while the first is still awaiting the network.
  const isCheckingAuthRef  = useRef(false);

  useEffect(() => { setIsMounted(true); }, []);

  // Cancel any in-flight requests when the provider unmounts.
  useEffect(() => {
    return () => {
      checkAbortRef.current?.abort();
      revalidateAbortRef.current?.abort();
    };
  }, []);

  // Fetch fresh auth state from backend, update React state and cache.
  const fetchAndUpdateAuth = useCallback(async (signal?: AbortSignal): Promise<void> => {
    try {
      const response = await apiClient.get(API_ENDPOINTS.GET_ME, { signal }) as any;

      if (response.success && response.user) {
        const userData = normalizeUser(response.user);
        setUser(userData);
        setToken(null);
        writeCache(userData, userData.sessionVersion);
      } else {
        apiClient.clearAuthToken();
        setUser(null);
        setToken(null);
        writeCache(null, 0);
      }
    } catch (err: any) {
      // Request was intentionally cancelled — don't touch state.
      if (err.name === 'AbortError') return;

      const isRateLimitError = err.status === 429 ||
        (err.message && err.message.includes('Too many requests'));

      if (isRateLimitError) {
        // Under rate limiting, keep whatever is already in React state.
        // Do not update or clear cache — let it expire naturally.
        console.warn('[AuthContext] Rate limited on auth check — using existing state');
        return;
      }

      const isAuthError =
        err.status === 401 ||
        err.message === 'Unauthorized' ||
        (err.message && err.message.includes('token failed'));

      if (!isAuthError) {
        console.error('[AuthContext] Auth check failed:', err);
      }

      apiClient.clearAuthToken();
      setUser(null);
      setToken(null);
      writeCache(null, 0);
    }
  }, []);

  // Silently revalidate cached auth in the background.
  // If sessionVersion or role changed server-side, update React state immediately
  // without waiting for the cache TTL to expire.
  const revalidateInBackground = useCallback(async (cached: CachedAuth, signal?: AbortSignal): Promise<void> => {
    try {
      const response = await apiClient.get(API_ENDPOINTS.GET_ME, { signal }) as any;

      if (response.success && response.user) {
        const fresh = normalizeUser(response.user);
        const versionChanged = fresh.sessionVersion !== cached.sessionVersion;
        const roleChanged    = fresh.role !== cached.user?.role;

        if (versionChanged || roleChanged) {
          // Server-side change detected (ban, role change, force-logout).
          // Update React state immediately, don't wait for TTL.
          setUser(fresh);
          writeCache(fresh, fresh.sessionVersion);
        }
      } else {
        // No longer authenticated server-side — clear immediately.
        setUser(null);
        clearCache();
      }
    } catch {
      // Background check failed — keep serving cached state, it will expire normally.
    }
  }, []);

  const checkAuth = useCallback(async () => {
    const cached = readCache();

    if (cached && isCacheValid(cached)) {
      // Serve cached state immediately (zero latency).
      setUser(cached.user ?? null);
      setToken(null);
      setIsLoading(false);

      if (cached.user) {
        // Cancel any previous background revalidation before starting a new one
        // so rapid navigation never leaves multiple revalidations racing.
        revalidateAbortRef.current?.abort();
        const controller = new AbortController();
        revalidateAbortRef.current = controller;
        revalidateInBackground(cached, controller.signal); // fire-and-forget
      }
      return;
    }

    // Cache missing or expired — do a full synchronous check.
    // Guard: if one is already in flight, skip rather than letting two fetches
    // race and potentially resolve out of order.
    if (isCheckingAuthRef.current) return;
    isCheckingAuthRef.current = true;

    // Cancel any previous sync fetch (e.g. from a prior navigation).
    checkAbortRef.current?.abort();
    const controller = new AbortController();
    checkAbortRef.current = controller;

    setIsLoading(true);
    try {
      await fetchAndUpdateAuth(controller.signal);
    } finally {
      isCheckingAuthRef.current = false;
      setIsLoading(false);
    }
  }, [fetchAndUpdateAuth, revalidateInBackground]);

  useEffect(() => {
    if (isMounted) {
      checkAuth();
    }
  }, [isMounted, checkAuth]);

  const login = useCallback(async (email: string, password: string) => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await apiClient.post(API_ENDPOINTS.LOGIN, { email, password }) as any;

      if (response.success && response.user) {
        const userData = normalizeUser(response.user);
        setToken(null);
        setUser(userData);
        writeCache(userData, userData.sessionVersion);
        identifyUser({ id: userData._id, email: userData.email, name: userData.name });
      } else {
        throw new Error(response.message || 'Login failed');
      }
    } catch (err: any) {
      let errorMessage = err.message || AUTH_ERROR_MESSAGES.GENERIC_AUTH_ERROR;

      if (err.status === 429 || errorMessage.includes('authentication attempts')) {
        const retryAfter = err.rateLimitInfo?.retryAfter || 900;
        errorMessage = AUTH_ERROR_MESSAGES.RATE_LIMIT_EXCEEDED(Math.ceil(retryAfter / 60));
      } else if (errorMessage.includes('Invalid email or password')) {
        errorMessage = AUTH_ERROR_MESSAGES.INVALID_CREDENTIALS;
      }

      setError(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const register = useCallback(async (name: string, email: string, password: string) => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await apiClient.post(API_ENDPOINTS.REGISTER, { name, email, password }) as any;

      if (response.success && response.user) {
        const userData = normalizeUser(response.user);
        setToken(null);
        setUser(userData);
        writeCache(userData, userData.sessionVersion);
        identifyUser({ id: userData._id, email: userData.email, name: userData.name });
        trackSignUp('email');
      } else {
        throw new Error(response.message || 'Registration failed');
      }
    } catch (err: any) {
      let errorMessage = err.message || AUTH_ERROR_MESSAGES.GENERIC_AUTH_ERROR;

      if (err.status === 429 || errorMessage.includes('authentication attempts')) {
        const retryAfter = err.rateLimitInfo?.retryAfter || 900;
        errorMessage = AUTH_ERROR_MESSAGES.RATE_LIMIT_EXCEEDED(Math.ceil(retryAfter / 60));
      } else if (errorMessage.includes('already exists')) {
        errorMessage = AUTH_ERROR_MESSAGES.ACCOUNT_EXISTS;
      }

      setError(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiClient.post('/auth/logout', {});
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      apiClient.clearAuthToken();
      setUser(null);
      setToken(null);
      setError(null);
      // Clear cache so the next checkAuth doesn't restore the old session.
      clearCache();
      resetAnalytics();
    }
  }, []);

  const clearError = useCallback(() => { setError(null); }, []);

  // Hydrates auth state directly from data returned by the exchange-code endpoint,
  // avoiding an extra GET /me round-trip after social login.
  const hydrateFromExchange = useCallback((rawUser: any) => {
    const userData = normalizeUser(rawUser);
    setUser(userData);
    setToken(null);
    setIsLoading(false);
    writeCache(userData, userData.sessionVersion);
  }, []);

  const value: AuthContextType = {
    user,
    token,
    isAuthenticated: !!user,
    isLoading,
    error,
    login,
    register,
    logout,
    checkAuth,
    hydrateFromExchange,
    clearError,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export default AuthContext;
