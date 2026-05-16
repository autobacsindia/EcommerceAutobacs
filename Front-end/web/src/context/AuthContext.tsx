'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import apiClient from '@/lib/api';
import { API_ENDPOINTS, AUTH_ERROR_MESSAGES } from '@/lib/constants';

interface User {
  _id: string;
  name: string;
  email: string;
  role: 'customer' | 'admin';
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
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  // Initialize state consistently for both server and client
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true); // Start with true to prevent UI flickering
  const [error, setError] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false); // Track if component is mounted
  
  // Set mounted state after initial render
  useEffect(() => {
    setIsMounted(true);
  }, []);
  

  
  // Enhanced checkAuth with better error handling and consistency
  const checkAuth = useCallback(async () => {
    // Try to get from localStorage first
    const cachedAuth = localStorage.getItem('auth_check');
    if (cachedAuth) {
      try {
        const parsedAuth = JSON.parse(cachedAuth);
        // Check if cache is still valid (5 minute expiration)
        const now = Date.now();
        if (parsedAuth.timestamp && (now - parsedAuth.timestamp) < 5 * 60 * 1000) {
          if (parsedAuth.user) {
            setUser(parsedAuth.user);
            setToken(null);
          } else {
            apiClient.clearAuthToken();
            setUser(null);
            setToken(null);
          }
          setIsLoading(false);
          return;
        }
      } catch (e) {
        console.warn('Failed to parse cached auth data:', e);
      }
    }
    
    try {
      setIsLoading(true);
      
      // With httpOnly cookies, we can't check token from JavaScript
      // Always verify with backend by calling GET /auth/me
      const response = await apiClient.get(API_ENDPOINTS.GET_ME) as any;
      
      if (response.success && response.user) {
        // Ensure consistent user data structure
        const userData: User = {
          _id: response.user._id,
          name: response.user.name,
          email: response.user.email,
          role: response.user.role
        };
        
        setUser(userData);
        // Don't set token - it's in httpOnly cookie
        setToken(null);
        
        // Cache the result for 5 minutes
        try {
          localStorage.setItem('auth_check', JSON.stringify({
            user: userData,
            timestamp: Date.now()
          }));
        } catch (e) {
          console.warn('Failed to cache auth check in localStorage:', e);
        }
      } else {
        // Invalid token - ensure consistent cleanup
        apiClient.clearAuthToken();
        setUser(null);
        setToken(null);
        
        // Cache the null result for 5 minutes
        try {
          localStorage.setItem('auth_check', JSON.stringify({
            user: null,
            timestamp: Date.now()
          }));
        } catch (e) {
          console.warn('Failed to cache auth check in localStorage:', e);
        }
      }
    } catch (err: any) {
      // Handle 429 rate limit errors specially
      const isRateLimitError = err.status === 429 || 
                               (err.message && err.message.includes('Too many requests'));
      
      if (isRateLimitError) {
        console.warn('[AuthContext] Rate limited on auth check, using cached data if available');
        // If we have cached user data, use it even if expired
        if (cachedAuth) {
          try {
            const parsedAuth = JSON.parse(cachedAuth);
            if (parsedAuth.user) {
              setUser(parsedAuth.user);
              setToken(null);
              setIsLoading(false);
              return;
            }
          } catch (e) {
            console.warn('Failed to parse cached auth data:', e);
          }
        }
        // No cached data available, set not authenticated
        apiClient.clearAuthToken();
        setUser(null);
        setToken(null);
        setIsLoading(false);
        return;
      }
      
      // Only log actual errors, not on expected auth failures
      const isAuthError = err.message === 'Unauthorized' || 
                          err.message === 'Not authorized, token failed' || 
                          err.status === 401 ||
                          (err.message && err.message.includes('token failed'));
                          
      if (!isAuthError) {
        console.error('Auth check failed:', err);
      }
      // Ensure consistent state on error
      apiClient.clearAuthToken();
      setUser(null);
      setToken(null);
      
      // Cache the error state for 5 minutes
      try {
        localStorage.setItem('auth_check', JSON.stringify({
          user: null,
          timestamp: Date.now()
        }));
      } catch (e) {
        console.warn('Failed to cache auth check in localStorage:', e);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Check authentication status after mount
  useEffect(() => {
    if (isMounted) {
      checkAuth();
    }
  }, [isMounted, checkAuth]);
  
  const login = useCallback(async (email: string, password: string) => {
    try {
      setIsLoading(true);
      setError(null);
      
      const response = await apiClient.post(API_ENDPOINTS.LOGIN, {
        email,
        password,
      }) as any;
      
      // Backend sets accessToken as httpOnly cookie (not in response body)
      // Check for success and user data (token is automatic via cookie)
      if (response.success && response.user) {
        const { user: userData } = response;

        const normalizedUser: User = {
          _id: userData.id || userData._id,
          name: userData.name,
          email: userData.email,
          role: userData.role
        };

        // Token is stored in httpOnly cookie (automatic, no manual storage needed)
        setToken(null);
        setUser(normalizedUser);

        // Update auth cache so checkAuth doesn't restore the pre-login null state on refresh
        try {
          localStorage.setItem('auth_check', JSON.stringify({
            user: normalizedUser,
            timestamp: Date.now()
          }));
        } catch (e) {
          console.warn('Failed to cache auth check after login:', e);
        }
      } else {
        throw new Error(response.message || 'Login failed');
      }
    } catch (err: any) {
      let errorMessage = err.message || AUTH_ERROR_MESSAGES.GENERIC_AUTH_ERROR;
      
      // Provide specific guidance for rate limit errors
      if (err.status === 429 || errorMessage.includes('authentication attempts')) {
        const retryAfter = err.rateLimitInfo?.retryAfter || 900;
        const minutes = Math.ceil(retryAfter / 60);
        errorMessage = AUTH_ERROR_MESSAGES.RATE_LIMIT_EXCEEDED(minutes);
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
      
      const response = await apiClient.post(API_ENDPOINTS.REGISTER, {
        name,
        email,
        password,
      }) as any;
      
      if (response.success && response.accessToken && response.user) {
        const { accessToken: authToken, user: userData } = response;
        
        // Store token and auto-login
        apiClient.setAuthToken(authToken);
        setToken(authToken);
        setUser({
          _id: userData.id || userData._id,
          name: userData.name,
          email: userData.email,
          role: userData.role
        });
      } else {
        throw new Error(response.message || 'Registration failed');
      }
    } catch (err: any) {
      let errorMessage = err.message || AUTH_ERROR_MESSAGES.GENERIC_AUTH_ERROR;
      
      // Provide specific guidance for rate limit errors
      if (err.status === 429 || errorMessage.includes('authentication attempts')) {
        const retryAfter = err.rateLimitInfo?.retryAfter || 900;
        const minutes = Math.ceil(retryAfter / 60);
        errorMessage = AUTH_ERROR_MESSAGES.RATE_LIMIT_EXCEEDED(minutes);
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
      // Call backend logout to clear httpOnly cookies
      await apiClient.post('/auth/logout', {});
    } catch (err) {
      console.error('Logout error:', err);
      // Continue with local cleanup even if backend call fails
    } finally {
      // Clear client-side state
      apiClient.clearAuthToken();
      setUser(null);
      setToken(null);
      setError(null);
    }
  }, []);
  
  const clearError = useCallback(() => {
    setError(null);
  }, []);
  
  // Ensure consistent value object structure
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