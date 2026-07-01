'use client';

import { ApiError, ErrorCategory } from '@/lib/api';

// Define error message mapping
const getErrorMessage = (error: any) => {
  if (error instanceof ApiError) {
    switch (error.category) {
      case ErrorCategory.NETWORK:
        return {
          title: "Network Connection Issue",
          message: "We're having trouble connecting to our servers. Please check your internet connection and try again.",
          action: "Try Again"
        };
      case ErrorCategory.AUTH:
        return {
          title: "Session Expired",
          message: "Your session has expired. Please log in again to continue.",
          action: "Log In"
        };
      case ErrorCategory.SERVER:
        return {
          title: "Server Temporarily Unavailable",
          message: "Our service is temporarily unavailable. This might be due to maintenance or high traffic. Please try again later.",
          action: "Try Again"
        };
      case ErrorCategory.CLIENT:
        return {
          title: "Request Error",
          message: "There was a problem with your request. Please check your filters or try again.",
          action: "Try Again"
        };
      case ErrorCategory.TIMEOUT:
        return {
          title: "Request Timeout",
          message: "The request took too long to complete. This might be due to a slow network or server issue. Please try again.",
          action: "Try Again"
        };
      case ErrorCategory.PARSING:
        return {
          title: "Data Processing Error",
          message: "We're having trouble processing the product data. Please refresh the page to try again.",
          action: "Refresh Page"
        };
      default:
        return {
          title: "Unable to Load Products",
          message: "We're having trouble loading products right now. This might be due to a network issue or temporary server problem.",
          action: "Try Again"
        };
    }
  }
  
  // Fallback for non-ApiError errors
  return {
    title: "Unable to Load Products",
    message: "We're having trouble loading products right now. Please try again.",
    action: "Try Again"
  };
};

export default function ProductFetchError({ onRetry, error }: { onRetry: () => void; error: Error | null }) {
  const errorInfo = getErrorMessage(error);
  
  const handleAction = () => {
    if (error instanceof ApiError && error.category === ErrorCategory.AUTH) {
      // Redirect to login page
      window.location.href = '/login';
    } else if (error instanceof ApiError && error.category === ErrorCategory.PARSING) {
      // Refresh the page
      window.location.reload();
    } else {
      // Default retry action
      onRetry();
    }
  };

  return (
    <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center max-w-2xl mx-auto">
      <div className="text-red-500 mb-2">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      </div>
      <h3 className="text-lg font-medium text-red-800 mb-2">{errorInfo.title}</h3>
      <p className="text-red-700 mb-4">
        {errorInfo.message}
      </p>
      <div className="flex flex-col sm:flex-row justify-center gap-3">
        <button
          onClick={handleAction}
          className="inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-ink bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="-ml-1 mr-2 h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
          </svg>
          {errorInfo.action}
        </button>
        <button
          onClick={() => window.location.reload()}
          className="inline-flex items-center justify-center px-4 py-2 border border-hairline text-sm font-medium rounded-md shadow-sm text-ink/80 bg-obsidian hover:bg-obsidian-deep focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gold"
        >
          Refresh Page
        </button>
      </div>
      
      {/* Technical details for debugging (only in development) */}
      {process.env.NODE_ENV === 'development' && error && (
        <div className="mt-4 text-left text-xs text-ink-muted bg-obsidian-raised p-3 rounded">
          <p><strong>Technical Details:</strong></p>
          <p>Error: {error.message}</p>
          {error instanceof ApiError && (
            <>
              <p>Status: {error.status || 'N/A'}</p>
              <p>Category: {error.category || 'N/A'}</p>
              <p>URL: {error.url || 'N/A'}</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}