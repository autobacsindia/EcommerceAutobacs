/**
 * Production Error Boundary Component
 * 
 * Features:
 * - Granular error isolation
 * - Sentry integration
 * - Fallback UI with retry
 * - Error reporting
 * 
 * Usage:
 *   <ErrorBoundary fallback={<CartFallback />}>
 *     <ShoppingCart />
 *   </ErrorBoundary>
 */

'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  feature?: string; // For Sentry tracking
  onReset?: () => void; // Called when boundary resets
  resetKeys?: any[]; // Auto-reset when these change (e.g., route)
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  private hasCaughtError: boolean = false;
  
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null
    };
  }

  /**
   * Auto-reset when resetKeys change (e.g., route navigation)
   */
  componentDidUpdate(prevProps: Props) {
    if (this.state.hasError && prevProps.resetKeys !== this.props.resetKeys) {
      // Keys changed, reset error state
      this.resetError();
    }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.hasCaughtError = true;
    
    // Log to console in development
    if (process.env.NODE_ENV === 'development') {
      console.error(`[ErrorBoundary:${this.props.feature || 'unknown'}]`, error);
      console.error('Component stack:', errorInfo.componentStack);
    }

    // Determine severity
    const severity = this.getSeverity(error);

    // Send to Sentry with severity level
    if (typeof window !== 'undefined' && (window as any).Sentry) {
      (window as any).Sentry.captureException(error, {
        level: severity,
        tags: {
          feature: this.props.feature || 'unknown',
          component: errorInfo.componentStack?.split('\n')[0] || 'unknown',
          severity: severity
        },
        extra: {
          componentStack: errorInfo.componentStack,
          timestamp: new Date().toISOString(),
          errorType: error.constructor.name
        }
      });
    }

    // Custom error handler
    this.props.onError?.(error, errorInfo);
  }

  /**
   * Determine error severity for better Sentry filtering
   */
  private getSeverity(error: Error): 'fatal' | 'error' | 'warning' {
    const message = error.message.toLowerCase();
    
    // Authentication errors (warning - user action needed)
    if (message.includes('unauthorized') || message.includes('forbidden') || message.includes('401') || message.includes('403')) {
      return 'warning';
    }
    
    // Network errors (error - retryable)
    if (message.includes('network') || message.includes('fetch') || message.includes('timeout')) {
      return 'error';
    }
    
    // Render crashes (fatal - needs investigation)
    if (message.includes('cannot read') || message.includes('undefined') || message.includes('null')) {
      return 'fatal';
    }
    
    return 'error'; // Default
  }

  /**
   * Reset error state with optional cleanup
   */
  resetError = () => {
    this.hasCaughtError = false;
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null
    });
    
    // Call custom reset handler (e.g., refetch data)
    this.props.onReset?.();
  };

  /**
   * Smart retry: reset + trigger data refresh
   */
  handleRetry = () => {
    // 1. Reset error state
    this.resetError();
    
    // 2. Clear React Query cache (if available)
    if (typeof window !== 'undefined' && (window as any).__reactQueryClient) {
      const queryClient = (window as any).__reactQueryClient;
      // Invalidate queries related to this feature
      if (this.props.feature) {
        queryClient.invalidateQueries({ queryKey: [this.props.feature] });
      }
    }
  };

  /**
   * Safe render: prevent infinite error loops
   */
  private safeRenderFallback(): ReactNode {
    try {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Determine error type for smart fallback
      const errorType = this.getErrorType();
      
      return this.getDefaultFallback(errorType);
    } catch (fallbackError) {
      // Fallback itself crashed - show minimal UI
      console.error('[ErrorBoundary] Fallback crashed:', fallbackError);
      return (
        <div className="error-boundary-critical">
          <div className="error-icon">⚠️</div>
          <h3>Critical Error</h3>
          <p>Please refresh the page</p>
          <button onClick={() => window.location.reload()}>Refresh</button>
        </div>
      );
    }
  }

  /**
   * Determine error type for appropriate fallback UI
   */
  private getErrorType(): 'network' | 'auth' | 'validation' | 'unknown' {
    if (!this.state.error) return 'unknown';
    
    const message = this.state.error.message.toLowerCase();
    
    if (message.includes('network') || message.includes('fetch') || message.includes('timeout')) {
      return 'network';
    }
    
    if (message.includes('unauthorized') || message.includes('forbidden') || message.includes('401')) {
      return 'auth';
    }
    
    if (message.includes('validation') || message.includes('invalid')) {
      return 'validation';
    }
    
    return 'unknown';
  }

  /**
   * Get appropriate fallback UI based on error type
   */
  private getDefaultFallback(errorType: string): ReactNode {
    switch (errorType) {
      case 'network':
        return (
          <div className="error-boundary-fallback">
            <div className="error-icon">🌐</div>
            <h3>Network Error</h3>
            <p className="error-message">
              Unable to connect to server. Please check your connection.
            </p>
            <button onClick={this.handleRetry} className="retry-button">
              Retry Connection
            </button>
          </div>
        );
      
      case 'auth':
        return (
          <div className="error-boundary-fallback">
            <div className="error-icon">🔒</div>
            <h3>Authentication Required</h3>
            <p className="error-message">
              Your session may have expired. Please login again.
            </p>
            <button onClick={() => window.location.href = '/login'} className="retry-button">
              Login Again
            </button>
          </div>
        );
      
      case 'validation':
        return (
          <div className="error-boundary-fallback">
            <div className="error-icon">⚠️</div>
            <h3>Invalid Data</h3>
            <p className="error-message">
              {this.state.error?.message || 'The data received was invalid'}
            </p>
            <button onClick={this.handleRetry} className="retry-button">
              Refresh Data
            </button>
          </div>
        );
      
      default:
        return (
          <div className="error-boundary-fallback">
            <div className="error-icon">⚠️</div>
            <h3>Something went wrong</h3>
            <p className="error-message">
              {this.state.error?.message || 'An unexpected error occurred'}
            </p>
            <button onClick={this.handleRetry} className="retry-button">
              Try Again
            </button>
            {process.env.NODE_ENV === 'development' && (
              <details className="error-details">
                <summary>Error Details (Dev Only)</summary>
                <pre>{this.state.error?.stack}</pre>
              </details>
            )}
          </div>
        );
    }
  }

  render() {
    if (this.state.hasError) {
      return this.safeRenderFallback();
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
