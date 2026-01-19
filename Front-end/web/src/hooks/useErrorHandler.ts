import { useCallback } from 'react';
import toast from 'react-hot-toast';

/**
 * Hook to handle API errors consistently across the application
 */
export const useErrorHandler = () => {
  const handleError = useCallback((error: any, customMessage?: string) => {
    // Log the error for debugging
    console.error('Error handled by useErrorHandler:', error);

    // Default message
    let message = customMessage || 'An unexpected error occurred. Please try again.';

    // Extract message from different error types
    if (error?.message) {
      // If it's an API Error from our client, it might have a specific structure
      // But usually error.message is populated by the ApiError class
      message = error.message;
    } else if (typeof error === 'string') {
      message = error;
    }

    // Special handling for common error scenarios
    if (message.toLowerCase().includes('network error')) {
      message = 'Unable to connect to the server. Please check your internet connection.';
    } else if (message.toLowerCase().includes('timeout')) {
      message = 'The request timed out. Please try again.';
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
