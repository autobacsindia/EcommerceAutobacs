/**
 * Checkout Error Boundary
 * 
 * Purpose: Protect checkout flow from JS errors
 * - Cart context crashes
 * - Razorpay initialization failures
 * - Address form errors
 * 
 * Features:
 * - Graceful degradation (cart still visible)
 * - Retry mechanism
 * - Sentry logging
 * - User-friendly error messages
 */

'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, ShoppingCart, Headphones } from 'lucide-react';

interface Props {
  children: ReactNode;
  feature?: 'cart' | 'checkout' | 'payment';
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class CheckoutErrorBoundary extends Component<Props, State> {
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

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // CRITICAL: Use fingerprinting to group similar errors (reduces Sentry noise)
    const fingerprint = [
      this.props.feature || 'checkout',
      error.name || 'UnknownError',
      error.message.split('\n')[0] // First line only (removes stack trace noise)
    ];

    // Log to Sentry with enhanced context
    if (typeof window !== 'undefined' && (window as any).Sentry) {
      (window as any).Sentry.captureException(error, {
        fingerprint, // Groups similar errors together
        tags: {
          feature: this.props.feature || 'checkout',
          component: 'CheckoutErrorBoundary',
          severity: 'critical'
        },
        extra: {
          componentStack: errorInfo.componentStack,
          url: window.location.href,
          timestamp: new Date().toISOString(),
          userAgent: window.navigator.userAgent,
          viewport: `${window.innerWidth}x${window.innerHeight}`
        }
        // Note: Cart/payment context should be added by parent component
        // contexts: { cart: {...}, payment: {...} }
      });
    }

    // Log to console (for debugging)
    console.error(`[${this.props.feature || 'checkout'}] Error:`, error);
    console.error('Component stack:', errorInfo.componentStack);
  }

  handleRetry = () => {
    // For checkout/payment errors, full reload is safest
    if (this.props.feature === 'checkout' || this.props.feature === 'payment') {
      window.location.reload();
    } else {
      // For cart errors, just reset state
      this.setState({
        hasError: false,
        error: null,
        errorInfo: null
      });
    }
  };

  render() {
    if (this.state.hasError) {
      const feature = this.props.feature || 'checkout';
      
      return (
        <div className="min-h-[400px] flex items-center justify-center p-6 bg-obsidian-deep">
          <div className="max-w-md w-full bg-obsidian rounded-lg shadow-lg p-8 text-center">
            {/* Error Icon */}
            <div className="mx-auto w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
              <AlertTriangle className="w-8 h-8 text-red-600" />
            </div>

            {/* Error Title */}
            <h2 className="text-2xl font-bold text-ink mb-2">
              {feature === 'payment' 
                ? 'Payment System Error'
                : feature === 'cart'
                ? 'Shopping Cart Error'
                : 'Checkout Unavailable'}
            </h2>

            {/* Error Message */}
            <p className="text-ink-muted mb-6">
              {feature === 'payment'
                ? 'We couldn\'t initialize the payment system. Please try again.'
                : feature === 'cart'
                ? 'We couldn\'t load your shopping cart. Your items are still saved.'
                : 'We couldn\'t load the checkout. Please try again.'}
            </p>

            {/* Cart Status (for cart/checkout errors) */}
            {(feature === 'cart' || feature === 'checkout') && (
              <div className="mb-6 p-4 bg-gold/10 border border-gold/40 rounded-lg">
                <div className="flex items-center justify-center gap-2 text-gold">
                  <ShoppingCart className="w-5 h-5" />
                  <span className="font-medium">Your cart is saved</span>
                </div>
                <p className="text-sm text-gold mt-1">
                  Your items are safe. You can continue shopping or try checkout again.
                </p>
              </div>
            )}

            {/* Action Buttons */}
            <div className="space-y-3">
              <button
                onClick={this.handleRetry}
                className="w-full px-6 py-3 bg-obsidian-deep text-ink rounded-lg font-medium hover:bg-obsidian-raised transition-colors flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                {feature === 'payment' ? 'Retry Payment' : 'Try Again'}
              </button>

              {/* Support Contact */}
              <div className="flex items-center justify-center gap-2 text-sm text-ink-muted">
                <Headphones className="w-4 h-4" />
                <span>Need help? Contact support</span>
              </div>
            </div>

            {/* Error Details (Dev Only) */}
            {process.env.NODE_ENV === 'development' && this.state.error && (
              <details className="mt-6 text-left">
                <summary className="cursor-pointer text-sm text-ink-muted hover:text-ink/80">
                  Error Details (Dev Only)
                </summary>
                <pre className="mt-2 p-3 bg-obsidian-raised rounded text-xs overflow-auto">
                  {this.state.error.message}
                  {'\n\n'}
                  {this.state.error.stack}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default CheckoutErrorBoundary;
