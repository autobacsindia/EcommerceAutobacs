/**
 * Accessible Error Boundary Component
 * 
 * Features:
 * - ARIA live regions for screen readers
 * - Keyboard navigation support
 * - Focus management
 * - Accessible fallback UI
 * 
 * Usage:
 *   <AccessibleErrorBoundary feature="cart">
 *     <ShoppingCart />
 *   </AccessibleErrorBoundary>
 */

'use client';

import React, { Component, ErrorInfo, ReactNode, createRef } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  feature?: string;
  onReset?: () => void;
  resetKeys?: any[];
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class AccessibleErrorBoundary extends Component<Props, State> {
  private errorRef = createRef<HTMLDivElement>();
  private retryButtonRef = createRef<HTMLButtonElement>();
  private previouslyFocusedElement: HTMLElement | null = null; // ← Focus restoration
  
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

  componentDidUpdate(prevProps: Props, prevState: State) {
    if (this.state.hasError && prevProps.resetKeys !== this.props.resetKeys) {
      this.resetError();
    }

    // Announce error to screen readers
    if (this.state.hasError && !prevState.hasError) {
      this.announceError();
      
      // Track focus before error (for restoration)
      if (typeof document !== 'undefined') {
        this.previouslyFocusedElement = document.activeElement as HTMLElement;
      }
    }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log to Sentry
    if (typeof window !== 'undefined' && (window as any).Sentry) {
      (window as any).Sentry.captureException(error, {
        tags: {
          feature: this.props.feature || 'unknown',
          severity: this.getSeverity(error)
        }
      });
    }

    this.props.onError?.(error, errorInfo);
  }

  /**
   * Announce error to screen readers
   */
  private announceError() {
    // Focus moves to error container
    if (this.errorRef.current) {
      this.errorRef.current.focus();
    }
  }

  /**
   * Determine error severity
   */
  private getSeverity(error: Error): 'fatal' | 'error' | 'warning' {
    const message = error.message.toLowerCase();
    
    if (message.includes('unauthorized') || message.includes('401')) {
      return 'warning';
    }
    
    if (message.includes('network') || message.includes('fetch')) {
      return 'error';
    }
    
    if (message.includes('cannot read') || message.includes('undefined')) {
      return 'fatal';
    }
    
    return 'error';
  }

  /**
   * Reset error state with focus restoration
   */
  resetError = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null
    });
    
    this.props.onReset?.();
    
    // Restore focus to previously focused element
    if (this.previouslyFocusedElement && typeof this.previouslyFocusedElement.focus === 'function') {
      setTimeout(() => {
        this.previouslyFocusedElement?.focus();
        this.previouslyFocusedElement = null;
      }, 100);
    }
  };

  /**
   * Handle retry with focus management
   */
  handleRetry = () => {
    this.resetError();
    
    // Return focus to retry button after reset
    setTimeout(() => {
      if (this.retryButtonRef.current) {
        this.retryButtonRef.current.focus();
      }
    }, 100);
  };

  /**
   * Handle keyboard events
   */
  handleKeyDown = (event: React.KeyboardEvent) => {
    // Enter or Space triggers retry
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.handleRetry();
    }
    
    // Escape triggers retry (for quick recovery)
    if (event.key === 'Escape') {
      this.handleRetry();
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          ref={this.errorRef}
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
          tabIndex={-1}
          className="error-boundary-fallback"
          onKeyDown={this.handleKeyDown}
        >
          <div className="error-icon" aria-hidden="true">⚠️</div>
          
          <h2 id="error-title" className="error-title">
            Something went wrong
          </h2>
          
          <p className="error-message" id="error-description">
            {this.state.error?.message || 'An unexpected error occurred'}
          </p>
          
          <button
            ref={this.retryButtonRef}
            onClick={this.handleRetry}
            aria-label="Try again"
            aria-describedby="error-description"
            className="retry-button"
            type="button"
          >
            Try Again
          </button>
          
          {process.env.NODE_ENV === 'development' && (
            <details className="error-details">
              <summary>Error Details (Dev Only)</summary>
              <pre aria-label="Error stack trace">
                {this.state.error?.stack}
              </pre>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

export default AccessibleErrorBoundary;
