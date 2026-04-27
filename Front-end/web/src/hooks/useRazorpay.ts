import { useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';
import apiClient from '@/lib/api';

interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  handler: (response: any) => void;
  modal: {
    ondismiss: () => void;
  };
  prefill: {
    name: string;
    email: string;
    contact: string;
  };
  theme: {
    color: string;
  };
}

interface UseRazorpayProps {
  onSuccess: (orderId: string) => void;
  onFailure?: (error: any) => void;
  originalCartTotal?: number; // For cart drift detection
  onRefetchCart?: () => Promise<void>; // For cart refresh before retry
}

// CRITICAL: Module-level promise cache prevents race conditions
// Multiple retries or concurrent calls share same load operation
let razorpayPromise: Promise<boolean> | null = null;

/**
 * Idempotent Razorpay script loader
 * - Prevents duplicate <script> tags
 * - Handles concurrent calls safely
 * - Reuses existing pending/loaded promise
 */
const loadRazorpayScript = (): Promise<boolean> => {
  // Return existing promise if already loading/loaded
  if (razorpayPromise) return razorpayPromise;

  razorpayPromise = new Promise((resolve) => {
    // Already loaded
    if ((window as any).Razorpay) {
      resolve(true);
      return;
    }

    // Check if script already exists (prevent duplicates)
    const existingScript = document.querySelector(
      'script[src="https://checkout.razorpay.com/v1/checkout.js"]'
    );

    if (existingScript) {
      // Script exists but not yet loaded
      existingScript.addEventListener('load', () => resolve(true), { once: true });
      existingScript.addEventListener('error', () => resolve(false), { once: true });
      return;
    }

    // Load new script
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    
    script.onload = () => {
      console.log('[Razorpay] Script loaded successfully');
      resolve(true);
    };
    
    script.onerror = () => {
      console.error('[Razorpay] Script failed to load');
      resolve(false);
    };

    document.body.appendChild(script);
  });

  return razorpayPromise;
};

/**
 * Timeout wrapper for async operations
 * Prevents silent hangs on slow networks
 */
const withTimeout = <T>(promise: Promise<T>, ms: number = 8000): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('Payment operation timed out. Please try again.')), ms)
    )
  ]);
};

export const useRazorpay = ({ 
  onSuccess, 
  onFailure,
  originalCartTotal,
  onRefetchCart
}: UseRazorpayProps) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [paymentError, setPaymentError] = useState<Error | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [isOnline, setIsOnline] = useState(
    typeof window !== 'undefined' ? navigator.onLine : true
  );
  const MAX_RETRIES = 2; // Circuit breaker: stop after 2 failures
  const router = useRouter();
  
  // Ref to prevent double-trigger
  const processingRef = useRef(false);

  // Track online/offline status
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => setIsOnline(true));
    window.addEventListener('offline', () => setIsOnline(false));
  }

  const processPayment = async (
    orderId: string, 
    amount: number, 
    userDetails: { name: string; email: string; phone: string }
  ) => {
    // CRITICAL: Prevent double-trigger (race condition)
    if (isProcessing || processingRef.current) {
      console.warn('[Razorpay] Payment already in progress, ignoring duplicate call');
      return;
    }

    setIsProcessing(true);
    processingRef.current = true;
    setPaymentError(null);
    
    // Track if payment outcome has been determined (success or failure) to prevent ondismiss from firing inappropriately
    let isPaymentProcessed = false;

    try {
      // CRITICAL: Check online status
      if (!navigator.onLine) {
        throw new Error('No internet connection. Please check your network and try again.');
      }

      // CRITICAL: Load Razorpay script (idempotent, prevents race conditions)
      const scriptLoaded = await withTimeout(loadRazorpayScript(), 10000); // 10s timeout for script load
      if (!scriptLoaded) {
        const error = new Error('Payment gateway failed to load. Please check your connection or disable ad blockers.');
        setPaymentError(error);
        toast.error(error.message);
        if (onFailure) onFailure(error);
        return;
      }

      // 1. Create Razorpay order on backend
      const razorpayResponse = await apiClient.post('/razorpay/create-order', {
        orderId,
        amount: Math.round(amount * 100), // Convert to paise
        currency: 'INR'
      }) as any;

      if (!razorpayResponse.success) {
        throw new Error('Failed to create Razorpay order');
      }

      // 2. Configure Razorpay options
      const options: RazorpayOptions = {
        key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || '',
        amount: razorpayResponse.data.amount,
        currency: razorpayResponse.data.currency,
        name: 'Autobacs India',
        description: `Order #${orderId}`,
        order_id: razorpayResponse.data.orderId,
        handler: async function (response: any) {
          isPaymentProcessed = true;
          try {
            // 3. Verify payment on backend (CRITICAL: Server-side signature verification)
            const verifyResponse = await apiClient.post('/razorpay/verify-payment', {
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
              orderId: orderId
            }) as any;

            if (verifyResponse.success) {
              toast.success('Payment successful!');
              setRetryCount(0); // Reset on success
              onSuccess(orderId);
            } else {
              const error = new Error(verifyResponse.message || 'Payment verification failed');
              setPaymentError(error);
              toast.error(error.message);
              if (onFailure) onFailure(error);
            }
          } catch (err: any) {
            const error = new Error(err.message || 'Payment verification failed');
            setPaymentError(error);
            toast.error(error.message);
            if (onFailure) onFailure(error);
          } finally {
            setIsProcessing(false);
            processingRef.current = false;
          }
        },
        modal: {
          ondismiss: async function () {
            if (isPaymentProcessed) return;

            toast('Payment cancelled', { icon: 'ℹ️' });

            try {
              await apiClient.put(`/orders/${orderId}/cancel`, {
                reason: 'customer_request',
                notes: 'Payment cancelled by user'
              });
              // Redirect to order details page where they can retry or see status
              router.push(`/orders/${orderId}`);
            } catch (error: any) {
              const errorMessage = error.message || '';
              // Ignore if order is already in a terminal state
              if (!errorMessage.includes('Current status: failed') && 
                  !errorMessage.includes('failed') && 
                  !errorMessage.includes('cannot be cancelled')) {
                 console.error('Failed to cancel order:', error);
              }
              // Even if error, redirect to order details
              router.push(`/orders/${orderId}`);
            }
            
            if (onFailure) onFailure(new Error('Payment cancelled'));
            setIsProcessing(false);
            processingRef.current = false;
          }
        },
        prefill: {
          name: userDetails.name,
          email: userDetails.email,
          contact: userDetails.phone,
        },
        theme: {
          color: '#2563eb'
        }
      };

      // 3. Open Razorpay Modal (with timeout to prevent silent hangs)
      if (!(window as any).Razorpay) {
        throw new Error('Payment gateway failed to load. Please refresh the page.');
      }

      const rzp = new (window as any).Razorpay(options);
      
      rzp.on('payment.failed', async function (response: any) {
        const reason =
          (response && (response.error?.description || response.error?.reason)) ||
          'Payment declined. Please try another card or method.';
        
        try {
          await apiClient.put(`/orders/${orderId}/payment-failed`, {
            reason: 'payment_failed',
            paymentId: response.error?.metadata?.payment_id,
            errorDescription: reason
          });
        } catch (error: any) {
          const errMsg = error.message || '';
          if (!errMsg.includes('Current status: failed')) {
            console.error('Failed to update order status:', error);
          }
        }

        toast.error(reason);
      });

      rzp.open();

    } catch (err: any) {
      const error = new Error(err.message || 'Failed to initiate Razorpay payment');
      setPaymentError(error);
      toast.error(error.message);
      if (onFailure) onFailure(err);
      setIsProcessing(false);
      processingRef.current = false;
    }
  };

  /**
   * Retry payment with circuit breaker + cart validation
   */
  const retryPayment = async (
    orderId: string,
    amount: number,
    userDetails: { name: string; email: string; phone: string }
  ) => {
    // Circuit breaker: Stop after max retries
    if (retryCount >= MAX_RETRIES) {
      const error = new Error('Payment failed multiple times. Please try a different payment method or contact support.');
      setPaymentError(error);
      toast.error(error.message);
      if (onFailure) onFailure(error);
      return;
    }

    // CRITICAL: Check online status before retry
    if (!navigator.onLine) {
      const error = new Error('No internet connection. Please reconnect and try again.');
      setPaymentError(error);
      toast.error(error.message);
      return;
    }

    // CRITICAL: Validate cart hasn't changed (prevent charging wrong amount)
    if (onRefetchCart && originalCartTotal) {
      try {
        await onRefetchCart();
        
        // Cart total validation would happen here if we had access to updated total
        // This is a placeholder for the actual validation logic
        console.log('[Razorpay] Cart refreshed before retry');
      } catch (err) {
        console.error('[Razorpay] Failed to refresh cart before retry:', err);
      }
    }

    setRetryCount(prev => prev + 1);
    setPaymentError(null);
    
    // Reset promise cache to allow script reload (handles CDN issues)
    razorpayPromise = null;
    
    await processPayment(orderId, amount, userDetails);
  };

  /**
   * Reset payment state (for manual recovery)
   */
  const resetPayment = useCallback(() => {
    setIsProcessing(false);
    processingRef.current = false;
    setPaymentError(null);
    setRetryCount(0);
    razorpayPromise = null; // Allow script reload
  }, []);

  return { 
    processPayment, 
    retryPayment,
    resetPayment,
    isProcessing, 
    paymentError,
    retryCount,
    maxRetries: MAX_RETRIES,
    hasReachedMaxRetries: retryCount >= MAX_RETRIES,
    isOnline
  };
};
