'use client';

import { useState } from 'react';
import { X, AlertCircle, CheckCircle } from 'lucide-react';
import apiClient from '@/lib/api';
import { API_ENDPOINTS, CANCELLATION_REASONS } from '@/lib/constants';

interface CancelOrderModalProps {
  orderId: string;
  orderNumber: string;
  totalAmount: number;
  hasPayment: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function CancelOrderModal({
  orderId,
  orderNumber,
  totalAmount,
  hasPayment,
  onClose,
  onSuccess,
}: CancelOrderModalProps) {
  const [selectedReason, setSelectedReason] = useState('');
  const [notes, setNotes] = useState('');
  const [confirmationChecked, setConfirmationChecked] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    refundInitiated: boolean;
    refundAmount: number;
    refundTimeline: string | null;
  } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validation
    if (!selectedReason) {
      setError('Please select a reason for cancellation');
      return;
    }

    if (!confirmationChecked) {
      setError('Please confirm you understand this action');
      return;
    }

    if (notes.length > 500) {
      setError('Notes cannot exceed 500 characters');
      return;
    }

    try {
      setIsSubmitting(true);
      
      const response = await apiClient.put(API_ENDPOINTS.ORDER_CANCEL(orderId), {
        reason: selectedReason,
        notes: notes.trim() || undefined,
      }) as any;

      setSuccess({
        refundInitiated: response.refundInitiated || false,
        refundAmount: response.refundAmount || 0,
        refundTimeline: response.refundTimeline || null,
      });
    } catch (err: any) {
      setError(err.message || 'Failed to cancel order. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (success) {
      onSuccess();
    }
    onClose();
  };

  // Success view
  if (success) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-lg max-w-md w-full max-h-[90vh] overflow-y-auto">
          <div className="p-6">
            {/* Success Icon */}
            <div className="flex justify-center mb-4">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
                <CheckCircle className="h-10 w-10 text-green-600" />
              </div>
            </div>

            {/* Success Message */}
            <h3 className="text-2xl font-bold text-center mb-2">Order Cancelled Successfully</h3>
            <p className="text-gray-600 text-center mb-6">
              Your order #{orderNumber} has been cancelled.
            </p>

            {/* Refund Information */}
            {success.refundInitiated && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                <p className="text-sm font-medium text-blue-900 mb-2">Refund Information</p>
                <p className="text-sm text-blue-800">
                  A refund of ₹{success.refundAmount.toFixed(2)} will be processed to your original payment method 
                  {success.refundTimeline && ` within ${success.refundTimeline}`}.
                </p>
              </div>
            )}

            {!success.refundInitiated && (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-6">
                <p className="text-sm text-gray-700">
                  Your order has been cancelled. No charges were made.
                </p>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex flex-col gap-3">
              <button
                onClick={handleClose}
                className="w-full bg-blue-600 text-white px-4 py-3 rounded-lg hover:bg-blue-700 font-medium transition"
              >
                View Order Details
              </button>
              <button
                onClick={() => window.location.href = '/orders'}
                className="w-full border border-gray-300 text-gray-700 px-4 py-3 rounded-lg hover:bg-gray-50 font-medium transition"
              >
                View All Orders
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Form view
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b sticky top-0 bg-white">
          <div>
            <h3 className="text-2xl font-bold">Cancel Order</h3>
            <p className="text-sm text-gray-600 mt-1">Order #{orderNumber}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition"
            disabled={isSubmitting}
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6">
          {/* Warning Message */}
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6 flex gap-3">
            <AlertCircle className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-yellow-900">
                Are you sure you want to cancel this order?
              </p>
              <p className="text-sm text-yellow-800 mt-1">
                This action cannot be undone. Your order will be cancelled immediately.
              </p>
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          {/* Reason Selection */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Reason for cancellation <span className="text-red-500">*</span>
            </label>
            <div className="space-y-2">
              {CANCELLATION_REASONS.map((reason, index) => (
                <label
                  key={index}
                  className={`flex items-center p-4 border rounded-lg cursor-pointer transition ${
                    selectedReason === reason.value
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-300 hover:border-gray-400'
                  }`}
                >
                  <input
                    type="radio"
                    name="reason"
                    value={reason.value}
                    checked={selectedReason === reason.value}
                    onChange={(e) => setSelectedReason(e.target.value)}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500"
                    disabled={isSubmitting}
                  />
                  <span className="ml-3 text-sm font-medium text-gray-900">{reason.label}</span>
                </label>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Your feedback helps us improve our service
            </p>
          </div>

          {/* Additional Notes */}
          <div className="mb-6">
            <label htmlFor="notes" className="block text-sm font-medium text-gray-700 mb-2">
              Additional details (optional)
            </label>
            <textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Please provide any additional information..."
              rows={4}
              maxLength={500}
              disabled={isSubmitting}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
            <div className="flex justify-between mt-2">
              <p className="text-xs text-gray-500">Optional - helps us understand your decision better</p>
              <p className="text-xs text-gray-500">{notes.length}/500</p>
            </div>
          </div>

          {/* Refund Information */}
          {hasPayment && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
              <p className="text-sm font-medium text-blue-900 mb-2">Refund Information</p>
              <div className="space-y-1 text-sm text-blue-800">
                <p>• Refund amount: ₹{totalAmount.toFixed(2)}</p>
                <p>• Refund method: Original payment method</p>
                <p>• Estimated timeline: 3-5 business days</p>
              </div>
            </div>
          )}

          {/* Confirmation Checkbox */}
          <div className="mb-6">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={confirmationChecked}
                onChange={(e) => setConfirmationChecked(e.target.checked)}
                disabled={isSubmitting}
                className="h-5 w-5 text-blue-600 focus:ring-blue-500 rounded mt-0.5"
              />
              <span className="text-sm text-gray-700">
                I understand this action cannot be undone and my order will be cancelled immediately.
              </span>
            </label>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col-reverse sm:flex-row gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Keep Order
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !selectedReason || !confirmationChecked}
              className="flex-1 px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                  <span>Cancelling...</span>
                </>
              ) : (
                'Cancel Order'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
