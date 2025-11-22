'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
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
  
  // Check authentication status after mount
  useEffect(() => {
    if (isMounted) {
      checkAuth();
    }
  }, [isMounted]);
  
  // Enhanced checkAuth with better error handling and consistency
  const checkAuth = async () => {
    try {
      setIsLoading(true);
      const savedToken = apiClient.getAuthToken();
      
      // If no token, ensure consistent state
      if (!savedToken) {
        setUser(null);
        setToken(null);
        setIsLoading(false);
        return;
      }
      
      // Verify token with backend
      const response = await apiClient.get(API_ENDPOINTS.GET_ME);
      
      if (response.success && response.user) {
        // Ensure consistent user data structure
        const userData: User = {
          _id: response.user._id,
          name: response.user.name,
          email: response.user.email,
          role: response.user.role
        };
        
        setUser(userData);
        setToken(savedToken);
      } else {
        // Invalid token - ensure consistent cleanup
        apiClient.clearAuthToken();
        setUser(null);
        setToken(null);
      }
    } catch (err: any) {
      // Only log actual errors, not on expected auth failures
      if (err.message !== 'Unauthorized') {
        console.error('Auth check failed:', err);
      }
      // Ensure consistent state on error
      apiClient.clearAuthToken();
      setUser(null);
      setToken(null);
    } finally {
      setIsLoading(false);
    }
  };
  
  const login = async (email: string, password: string) => {
    try {
      setIsLoading(true);
      setError(null);
      
      const response = await apiClient.post(API_ENDPOINTS.LOGIN, {
        email,
        password,
      });
      
      if (response.success && response.token && response.user) {
        const { token: authToken, user: userData } = response;
        
        // Store token
        apiClient.setAuthToken(authToken);
        setToken(authToken);
        setUser({
          _id: userData._id,
          name: userData.name,
          email: userData.email,
          role: userData.role
        });
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
  };
  
  const register = async (name: string, email: string, password: string) => {
    try {
      setIsLoading(true);
      setError(null);
      
      const response = await apiClient.post(API_ENDPOINTS.REGISTER, {
        name,
        email,
        password,
      });
      
      if (response.success && response.token && response.user) {
        const { token: authToken, user: userData } = response;
        
        // Store token and auto-login
        apiClient.setAuthToken(authToken);
        setToken(authToken);
        setUser({
          _id: userData._id,
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
  };
  
  const logout = () => {
    apiClient.clearAuthToken();
    setUser(null);
    setToken(null);
    setError(null);
  };
  
  const clearError = () => {
    setError(null);
  };
  
  // Ensure consistent value object structure
  const value: AuthContextType = {
    user,
    token,
    isAuthenticated: !!user && !!token,
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