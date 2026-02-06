// Global error handler for unhandled promise rejections and other errors
import * as Sentry from '@sentry/react';

class ErrorHandler {
  private static instance: ErrorHandler;
  private listeners: Array<(error: Error) => void> = [];

  private constructor() {
    // Set up global error handlers
    if (typeof window !== 'undefined') {
      window.addEventListener('error', this.handleError.bind(this));
      window.addEventListener('unhandledrejection', this.handleUnhandledRejection.bind(this));
    }
  }

  public static getInstance(): ErrorHandler {
    if (!ErrorHandler.instance) {
      ErrorHandler.instance = new ErrorHandler();
    }
    return ErrorHandler.instance;
  }

  private handleError(event: ErrorEvent) {
    const error = event.error || new Error(event.message);
    this.notifyListeners(error);
    this.logError(error, 'Global Error');
  }

  private handleUnhandledRejection(event: PromiseRejectionEvent) {
    const error = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
    this.notifyListeners(error);
    this.logError(error, 'Unhandled Promise Rejection');
    
    // Prevent the default browser behavior
    event.preventDefault();
  }

  public addListener(callback: (error: Error) => void) {
    this.listeners.push(callback);
  }

  public removeListener(callback: (error: Error) => void) {
    const index = this.listeners.indexOf(callback);
    if (index > -1) {
      this.listeners.splice(index, 1);
    }
  }

  private notifyListeners(error: Error) {
    this.listeners.forEach(callback => {
      try {
        callback(error);
      } catch (e) {
        console.error('Error in error listener:', e);
      }
    });
  }

  public logError(error: Error, context: string = 'Application Error') {
    console.error(`[${context}]`, error);
    try {
      Sentry.captureException(error, { tags: { context } });
    } catch {}
    
    // Log to analytics service if available
    if (typeof window !== 'undefined' && (window as any).gtag) {
      (window as any).gtag('event', 'exception', {
        description: `${context}: ${error.message}`,
        fatal: false
      });
    }
  }

  // Method to manually report an error
  public reportError(error: Error, context: string = 'Manual Report') {
    this.logError(error, context);
    this.notifyListeners(error);
  }
}

// Export a singleton instance
export const errorHandler = ErrorHandler.getInstance();

// Initialize the error handler
if (typeof window !== 'undefined') {
  errorHandler; // This will trigger the singleton creation
}
