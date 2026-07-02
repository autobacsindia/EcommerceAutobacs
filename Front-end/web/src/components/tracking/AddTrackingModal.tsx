'use client';

import { useState } from 'react';
import { CarrierSelector } from './CarrierSelector';
import trackingService from '@/services/trackingService';

interface AddTrackingModalProps {
  isOpen: boolean;
  onClose: () => void;
  orderId: string;
  onSuccess: () => void;
}

export function AddTrackingModal({ isOpen, onClose, orderId, onSuccess }: AddTrackingModalProps) {
  const [selectedCarrier, setSelectedCarrier] = useState<string>('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!selectedCarrier) {
      setError('Please select a carrier');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await trackingService.addTracking(orderId, {
        carrierCode: selectedCarrier,
        trackingNumber: trackingNumber.trim() || undefined,
        notes: notes.trim() || undefined
      });

      onSuccess();
      handleClose();
    } catch (err: any) {
      console.error('Add tracking error:', err);
      setError(err.message || 'Failed to add tracking information');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      setSelectedCarrier('');
      setTrackingNumber('');
      setNotes('');
      setError(null);
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-obsidian-deep bg-opacity-50 transition-opacity"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-obsidian rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
          {/* Header */}
          <div className="sticky top-0 bg-obsidian border-b border-hairline px-6 py-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-ink">Add Tracking Information</h2>
            <button
              onClick={handleClose}
              disabled={loading}
              className="text-ink-muted hover:text-ink-muted disabled:opacity-50"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Content */}
          <form onSubmit={handleSubmit} className="p-6 space-y-6">
            {/* Error Message */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <div className="flex">
                  <svg className="h-5 w-5 text-red-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                  <p className="ml-3 text-sm text-red-700">{error}</p>
                </div>
              </div>
            )}

            {/* Carrier Selection */}
            <div>
              <label className="block text-sm font-medium text-ink/80 mb-2">
                Select Carrier *
              </label>
              <CarrierSelector
                onCarrierSelect={setSelectedCarrier}
                selectedCarrier={selectedCarrier}
              />
            </div>

            {/* Optional Tracking Number */}
            <div>
              <label htmlFor="tracking-number" className="block text-sm font-medium text-ink/80 mb-2">
                Tracking Number (Optional)
              </label>
              <input
                id="tracking-number"
                type="text"
                value={trackingNumber}
                onChange={(e) => setTrackingNumber(e.target.value)}
                placeholder="Leave empty to auto-generate"
                className="w-full px-4 py-2 border border-hairline rounded-lg focus:ring-2 focus:ring-gold focus:border-transparent"
                disabled={loading}
              />
              <p className="mt-1 text-xs text-ink-muted">
                If not provided, a tracking number will be automatically generated
              </p>
            </div>

            {/* Notes */}
            <div>
              <label htmlFor="notes" className="block text-sm font-medium text-ink/80 mb-2">
                Notes (Optional)
              </label>
              <textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add any additional notes..."
                rows={3}
                className="w-full px-4 py-2 border border-hairline rounded-lg focus:ring-2 focus:ring-gold focus:border-transparent resize-none"
                disabled={loading}
              />
            </div>

            {/* Info Box */}
            <div className="bg-gold/10 border border-gold/40 rounded-lg p-4">
              <div className="flex">
                <svg className="h-5 w-5 text-gold mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
                <div className="ml-3">
                  <p className="text-sm text-gold">
                    After adding tracking information, the order status will be updated to "shipped" and customers will be able to track their package.
                  </p>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-4 border-t border-hairline">
              <button
                type="button"
                onClick={handleClose}
                disabled={loading}
                className="px-4 py-2 border border-hairline rounded-lg text-ink/80 hover:bg-obsidian-deep disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || !selectedCarrier}
                className="px-6 py-2 bg-gold text-obsidian rounded-lg hover:bg-gold disabled:bg-obsidian-raised disabled:cursor-not-allowed transition-colors flex items-center"
              >
                {loading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-hairline mr-2"></div>
                    Adding...
                  </>
                ) : (
                  'Add Tracking'
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
