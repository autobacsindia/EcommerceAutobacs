import { useState } from 'react';
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
}

export const useRazorpay = ({ onSuccess, onFailure }: UseRazorpayProps) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const router = useRouter();

  const processPayment = async (
    orderId: string, 
    amount: number, 
    userDetails: { name: string; email: string; phone: string }
  ) => {
    setIsProcessing(true);
    
    // Track if payment outcome has been determined (success or failure) to prevent ondismiss from firing inappropriately
    let isPaymentProcessed = false;

    try {
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
            // 3. Verify payment on backend
            const verifyResponse = await apiClient.post('/razorpay/verify-payment', {
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
              orderId: orderId
            }) as any;

            if (verifyResponse.success) {
              toast.success('Payment successful!');
              onSuccess(orderId);
            } else {
              const error = new Error('Payment verification failed');
              toast.error(error.message);
              if (onFailure) onFailure(error);
            }
          } catch (err: any) {
            const error = new Error(err.message || 'Payment verification failed');
            toast.error(error.message);
            if (onFailure) onFailure(error);
          } finally {
            setIsProcessing(false);
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
              if (!errorMessage.includes('failed') && !errorMessage.includes('cannot be cancelled')) {
                 console.error('Failed to cancel order:', error);
              }
              router.push(`/orders/${orderId}`);
            }
            
            if (onFailure) onFailure(new Error('Payment cancelled'));
            setIsProcessing(false);
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

      // 3. Open Razorpay Modal
      if (!(window as any).Razorpay) {
        throw new Error('Payment gateway failed to load. Please refresh the page.');
      }

      const rzp = new (window as any).Razorpay(options);
      
      rzp.on('payment.failed', async function (response: any) {
        // Do not set isPaymentProcessed = true here, as the user might retry in the same modal.
        
        const reason =
          (response && (response.error?.description || response.error?.reason)) ||
          'Payment declined. Please try another card or method.';
        
        try {
          await apiClient.put(`/orders/${orderId}/payment-failed`, {
            reason: 'payment_failed',
            paymentId: response.error?.metadata?.payment_id,
            errorDescription: reason
          });
        } catch (error) {
          console.error('Failed to update order status:', error);
        }

        toast.error(reason);
        // We don't call onFailure here to allow retry within the modal, 
        // unless you want to close the modal on failure.
      });

      rzp.open();

    } catch (err: any) {
      toast.error(err.message || 'Failed to initiate Razorpay payment');
      if (onFailure) onFailure(err);
      setIsProcessing(false); // Only set false on initial setup error, otherwise modal handles it
    }
  };

  return { processPayment, isProcessing };
};
