'use client';

import { useState, useEffect, useCallback } from 'react';
import { errorHandler } from '../errorHandler';

export const useErrorHandler = () => {
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Handle error
  const handleError = useCallback((error: Error) => {
    setError(error);
    setIsLoading(false);
    errorHandler.logError(error, 'Component Error');
  }, []);

  // Clear error
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Handle async operation with error handling
  const handleAsyncOperation = useCallback(async <T,>(operation: () => Promise<T>): Promise<T | null> => {
    setIsLoading(true);
    setError(null);
    
    try {
      const result = await operation();
      setIsLoading(false);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      handleError(error);
      return null;
    }
  }, [handleError]);

  // Set up global error listener
  useEffect(() => {
    const listener = (error: Error) => {
      // Only set error if we don't already have one
      if (!error) {
        setError(error);
      }
    };
    
    errorHandler.addListener(listener);
    
    return () => {
      errorHandler.removeListener(listener);
    };
  }, []);

  return {
    error,
    isLoading,
    handleError,
    clearError,
    handleAsyncOperation
  };
};