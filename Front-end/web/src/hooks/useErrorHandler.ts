import { useCallback } from 'react';
import toast from 'react-hot-toast';
import { ApiError, ErrorCategory } from '@/lib/api';

/**
 * Hook to handle API errors consistently across the application
 */
export const useErrorHandler = () => {
  const handleError = useCallback((error: any, customMessage?: string) => {
    // Log the error for debugging
    console.error('Error handled by useErrorHandler:', error);

    // Default message
    let message = customMessage || 'An unexpected error occurred. Please try again.';

    if (error instanceof ApiError) {
      switch (error.category) {
        case ErrorCategory.NETWORK:
          message = 'Unable to connect to the server. Please check your internet connection.';
          break;
        case ErrorCategory.TIMEOUT:
          message = 'The request timed out. Please try again.';
          break;
        case ErrorCategory.AUTH:
          message = 'Your session has expired. Please log in again.';
          break;
        case ErrorCategory.SERVER:
          message = 'The server is temporarily unavailable. Please try again later.';
          break;
        case ErrorCategory.PARSING:
          message = 'Received invalid data from the server. Please refresh and try again.';
          break;
        default:
          message = error.message || message;
      }
    } else if (error?.message) {
      message = error.message;
    } else if (typeof error === 'string') {
      message = error;
    }

    if (typeof message === 'string') {
      const m = message.toLowerCase();
      if (m.includes('network error')) {
        message = 'Unable to connect to the server. Please check your internet connection.';
      } else if (m.includes('timeout')) {
        message = 'The request timed out. Please try again.';
      }
    }

    // Show toast notification
    toast.error(message, {
      duration: 5000,
      position: 'top-right',
    });

    return message;
  }, []);

  return { handleError };
};
