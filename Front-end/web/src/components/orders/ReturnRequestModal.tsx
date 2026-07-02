'use client';

import { useState } from 'react';
import { X, CheckCircle, ChevronRight, ChevronLeft, AlertCircle } from 'lucide-react';
import apiClient from '@/lib/api';
import { API_ENDPOINTS, RETURN_REASONS } from '@/lib/constants';
import OrderItemCard from './shared/OrderItemCard';
import ImageUploader from './shared/ImageUploader';

interface OrderItem {
  _id: string;
  product?: {
    _id: string;
    name: string;
    price: number;
    images?: Array<{ url: string; alt?: string }>;
  };
  quantity: number;
  price: number;
  name?: string;
  image?: string;
}

interface SelectedItem {
  productId: string;
  quantity: number;
  reason?: string;
}

interface UploadedImage {
  url: string;
  description?: string;
}

interface ReturnRequestModalProps {
  orderId: string;
  orderNumber: string;
  items: OrderItem[];
  deliveredAt: string;
  onClose: () => void;
  onSuccess: () => void;
}

export default function ReturnRequestModal({
  orderId,
  orderNumber,
  items,
  deliveredAt,
  onClose,
  onSuccess,
}: ReturnRequestModalProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const [selectedItems, setSelectedItems] = useState<Map<string, SelectedItem>>(new Map());
  const [requestType, setRequestType] = useState<'return' | 'exchange'>('return');
  const [returnReason, setReturnReason] = useState('');
  const [description, setDescription] = useState('');
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [videoUrl, setVideoUrl] = useState('');
  const [policyAccepted, setPolicyAccepted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ returnRequestId: string } | null>(null);

  const totalSteps = 4;

  // Calculate days since delivery
  const daysSinceDelivery = Math.floor(
    (new Date().getTime() - new Date(deliveredAt).getTime()) / (1000 * 60 * 60 * 24)
  );

  // Check eligibility
  if (daysSinceDelivery > 7) {
    return (
      <div className="fixed inset-0 bg-obsidian-deep bg-opacity-50 flex items-center justify-center p-4 z-50">
        <div className="bg-obsidian rounded-lg max-w-md w-full p-6">
          <div className="flex items-center justify-center mb-4">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center">
              <AlertCircle className="h-10 w-10 text-red-600" />
            </div>
          </div>
          <h3 className="text-xl font-bold text-center mb-2">Return Window Expired</h3>
          <p className="text-ink-muted text-center mb-6">
            Returns must be requested within 7 days of delivery. Your order was delivered {daysSinceDelivery} days ago.
          </p>
          <button
            onClick={onClose}
            className="w-full bg-gold text-obsidian px-4 py-3 rounded-lg hover:bg-gold font-medium transition"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  const handleItemSelect = (item: OrderItem, selected: boolean) => {
    const newSelected = new Map(selectedItems);
    if (selected) {
      newSelected.set(item._id, {
        productId: item.product?._id || item._id,
        quantity: 1,
      });
    } else {
      newSelected.delete(item._id);
    }
    setSelectedItems(newSelected);
  };

  const handleQuantityChange = (itemId: string, quantity: number) => {
    const newSelected = new Map(selectedItems);
    const item = newSelected.get(itemId);
    if (item) {
      newSelected.set(itemId, { ...item, quantity });
    }
    setSelectedItems(newSelected);
  };

  const calculateRefundAmount = () => {
    let total = 0;
    selectedItems.forEach((selectedItem, itemId) => {
      const orderItem = items.find(i => i._id === itemId);
      if (orderItem) {
        total += orderItem.price * selectedItem.quantity;
      }
    });
    return total;
  };

  const validateStep = (step: number): string | null => {
    switch (step) {
      case 1:
        if (selectedItems.size === 0) {
          return 'Please select at least one item to return';
        }
        break;
      case 2:
        if (!returnReason) {
          return 'Please select a reason for return';
        }
        if (['defective', 'wrong_item', 'other'].includes(returnReason) && !description.trim()) {
          return 'Please describe the issue';
        }
        if (description.length > 1000) {
          return 'Description cannot exceed 1000 characters';
        }
        break;
      case 3:
        // Images/Video are optional but encouraged
        break;
      case 4:
        if (!policyAccepted) {
          return 'Please accept the return policy to continue';
        }
        break;
    }
    return null;
  };

  const handleNext = () => {
    const validationError = validateStep(currentStep);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    if (currentStep < totalSteps) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    setError(null);
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleSubmit = async () => {
    const validationError = validateStep(4);
    if (validationError) {
      setError(validationError);
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);

      const itemsToReturn = Array.from(selectedItems.entries()).map(([itemId, selectedItem]) => ({
        productId: selectedItem.productId,
        quantity: selectedItem.quantity,
        reason: returnReason, // Apply main reason to all items for now
      }));

      const payload = {
        orderId,
        items: itemsToReturn,
        type: requestType,
        reason: returnReason,
        description: description.trim() || undefined,
        images: images.length > 0 ? images : undefined,
        video: videoUrl ? { url: videoUrl, description: 'Unboxing Video' } : undefined,
        refundMethod: requestType === 'exchange' ? 'original_payment' : 'store_credit' // Default to store credit for returns
      };

      const response = await apiClient.post(API_ENDPOINTS.RETURN_CREATE, payload);
      
      setSuccess({
        returnRequestId: (response as any)._id || 'N/A',
      });
    } catch (err: any) {
      setError(err.message || 'Failed to submit return request. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Success view
  if (success) {
    return (
      <div className="fixed inset-0 bg-obsidian-deep bg-opacity-50 flex items-center justify-center p-4 z-50">
        <div className="bg-obsidian rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
          <div className="p-6">
            <div className="flex justify-center mb-4">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
                <CheckCircle className="h-10 w-10 text-green-600" />
              </div>
            </div>

            <h3 className="text-2xl font-bold text-center mb-2">Request Submitted</h3>
            <p className="text-ink-muted text-center mb-4">
              Your {requestType} request for order #{orderNumber} has been submitted successfully.
            </p>

            <div className="bg-obsidian-deep border border-hairline rounded-lg p-4 mb-6">
              <p className="text-sm font-medium text-ink/80 mb-1">Request ID</p>
              <p className="text-lg font-mono font-bold">{success.returnRequestId}</p>
            </div>

            <div className="bg-gold/10 border border-gold/40 rounded-lg p-4 mb-6">
              <p className="text-sm font-medium text-gold mb-3">What happens next:</p>
              <ul className="space-y-2 text-sm text-gold">
                <li className="flex gap-2">
                  <span className="text-gold font-bold">1.</span>
                  <span>We'll review your request within 24-48 hours</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-gold font-bold">2.</span>
                  <span>You'll receive an email if your request is approved</span>
                </li>
                {requestType === 'return' ? (
                  <li className="flex gap-2">
                    <span className="text-gold font-bold">3.</span>
                    <span>Refund will be credited to your wallet after inspection</span>
                  </li>
                ) : (
                  <li className="flex gap-2">
                    <span className="text-gold font-bold">3.</span>
                    <span>Replacement item will be shipped after we receive the return</span>
                  </li>
                )}
              </ul>
            </div>

            <div className="flex flex-col gap-3">
              <button
                onClick={() => {
                  onSuccess();
                  onClose();
                }}
                className="w-full bg-gold text-obsidian px-4 py-3 rounded-lg hover:bg-gold font-medium transition"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-obsidian-deep bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-obsidian rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-obsidian border-b z-10">
          <div className="flex items-center justify-between p-6">
            <div>
              <h3 className="text-2xl font-bold">Request Return / Exchange</h3>
              <p className="text-sm text-ink-muted mt-1">Order #{orderNumber}</p>
            </div>
            <button
              onClick={onClose}
              className="text-ink-muted hover:text-ink-muted transition"
              disabled={isSubmitting}
            >
              <X className="h-6 w-6" />
            </button>
          </div>

          {/* Progress Indicator */}
          <div className="px-6 pb-4">
            <div className="flex items-center justify-between mb-2">
              {[1, 2, 3, 4].map((step) => (
                <div key={step} className="flex items-center flex-1">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                      step <= currentStep
                        ? 'bg-gold text-obsidian'
                        : 'bg-obsidian-raised text-ink-muted'
                    }`}
                  >
                    {step}
                  </div>
                  {step < 4 && (
                    <div
                      className={`flex-1 h-1 mx-2 ${
                        step < currentStep ? 'bg-gold' : 'bg-obsidian-raised'
                      }`}
                    />
                  )}
                </div>
              ))}
            </div>
            <div className="flex justify-between text-xs text-ink-muted">
              <span>Items & Type</span>
              <span>Reason</span>
              <span>Evidence</span>
              <span>Review</span>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Error Message */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          {/* Step 1: Select Items & Type */}
          {currentStep === 1 && (
            <div className="space-y-6">
              <div>
                <h4 className="font-bold text-lg mb-2">Select Items</h4>
                <p className="text-sm text-ink-muted mb-4">
                  Choose which items you'd like to return or exchange
                </p>
              </div>

              {/* Request Type Selection */}
              <div className="flex gap-4 mb-6">
                <button
                  type="button"
                  onClick={() => setRequestType('return')}
                  className={`flex-1 p-4 border rounded-lg text-center transition ${
                    requestType === 'return'
                      ? 'border-gold bg-gold/10 text-gold font-medium'
                      : 'border-hairline hover:border-hairline'
                  }`}
                >
                  Return for Refund
                </button>
                <button
                  type="button"
                  onClick={() => setRequestType('exchange')}
                  className={`flex-1 p-4 border rounded-lg text-center transition ${
                    requestType === 'exchange'
                      ? 'border-gold bg-gold/10 text-gold font-medium'
                      : 'border-hairline hover:border-hairline'
                  }`}
                >
                  Exchange Item
                </button>
              </div>

              <div className="space-y-3">
                {items.map((item) => {
                  const isSelected = selectedItems.has(item._id);
                  const selectedItem = selectedItems.get(item._id);

                  return (
                    <div key={item._id}>
                      <OrderItemCard
                        item={item}
                        mode="select"
                        selected={isSelected}
                        onSelect={(selected) => handleItemSelect(item, selected)}
                      />
                      {isSelected && selectedItem && (
                        <div className="ml-14 mt-2 flex items-center gap-4">
                          <label className="text-sm font-medium text-ink/80">Quantity:</label>
                          <div className="flex items-center border border-hairline rounded-lg overflow-hidden">
                            <button
                              type="button"
                              onClick={() => handleQuantityChange(item._id, Math.max(1, selectedItem.quantity - 1))}
                              className="px-3 py-1 bg-obsidian-raised hover:bg-obsidian-raised transition"
                            >
                              -
                            </button>
                            <span className="px-4 py-1 min-w-[3rem] text-center">{selectedItem.quantity}</span>
                            <button
                              type="button"
                              onClick={() => handleQuantityChange(item._id, Math.min(item.quantity, selectedItem.quantity + 1))}
                              className="px-3 py-1 bg-obsidian-raised hover:bg-obsidian-raised transition"
                            >
                              +
                            </button>
                          </div>
                          <span className="text-sm text-ink-muted">of {item.quantity} available</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {selectedItems.size > 0 && requestType === 'return' && (
                <div className="bg-gold/10 border border-gold/40 rounded-lg p-4 mt-4">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-sm font-medium text-gold">
                        {selectedItems.size} item{selectedItems.size > 1 ? 's' : ''} selected
                      </p>
                      <p className="text-xs text-gold mt-1">
                        Estimated refund: ₹{calculateRefundAmount().toFixed(2)} (Store Credit)
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 2: Reason and Details */}
          {currentStep === 2 && (
            <div className="space-y-6">
              <div>
                <h4 className="font-bold text-lg mb-2">Reason for {requestType === 'return' ? 'Return' : 'Exchange'}</h4>
                <p className="text-sm text-ink-muted mb-4">
                  Please tell us why you're requesting a {requestType}
                </p>
              </div>

              <div className="space-y-3">
                {RETURN_REASONS.map((reason) => (
                  <label
                    key={reason.value}
                    className={`flex flex-col p-4 border rounded-lg cursor-pointer transition ${
                      returnReason === reason.value
                        ? 'border-gold bg-gold/10'
                        : 'border-hairline hover:border-hairline'
                    }`}
                  >
                    <div className="flex items-start">
                      <input
                        type="radio"
                        name="returnReason"
                        value={reason.value}
                        checked={returnReason === reason.value}
                        onChange={(e) => setReturnReason(e.target.value)}
                        className="h-4 w-4 text-gold focus:ring-gold mt-1"
                      />
                      <div className="ml-3 flex-1">
                        <span className="font-medium text-ink">{reason.label}</span>
                        <p className="text-sm text-ink-muted mt-1">{reason.description}</p>
                      </div>
                    </div>
                  </label>
                ))}
              </div>

              {/* Description */}
              {returnReason && (
                <div>
                  <label htmlFor="description" className="block text-sm font-medium text-ink/80 mb-2">
                    Describe the issue {['defective', 'wrong_item', 'not_as_described', 'other'].includes(returnReason) && (
                      <span className="text-red-500">*</span>
                    )}
                  </label>
                  <textarea
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Please provide additional details..."
                    rows={4}
                    maxLength={1000}
                    className="w-full px-4 py-3 border border-hairline rounded-lg focus:outline-none focus:ring-2 focus:ring-gold resize-none"
                  />
                  <div className="flex justify-between mt-2">
                    <p className="text-xs text-ink-muted">
                      {['defective', 'wrong_item', 'not_as_described', 'other'].includes(returnReason)
                        ? 'Required - Please provide details'
                        : 'Optional'}
                    </p>
                    <p className="text-xs text-ink-muted">{description.length}/1000</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 3: Upload Images/Video */}
          {currentStep === 3 && (
            <div className="space-y-6">
              <div>
                <h4 className="font-bold text-lg mb-2">Evidence (Optional but Recommended)</h4>
                <p className="text-sm text-ink-muted mb-4">
                  Photos and videos help us expedite your request, especially for damaged or defective items.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-ink/80 mb-2">Photos</label>
                <ImageUploader images={images} onImagesChange={setImages} />
              </div>

              <div>
                <label htmlFor="videoUrl" className="block text-sm font-medium text-ink/80 mb-2">
                  Unboxing/Issue Video URL
                </label>
                <input
                  type="url"
                  id="videoUrl"
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  placeholder="https://drive.google.com/..."
                  className="w-full px-4 py-3 border border-hairline rounded-lg focus:outline-none focus:ring-2 focus:ring-gold"
                />
                <p className="text-xs text-ink-muted mt-1">
                  Please upload your video to a cloud storage (Google Drive, Dropbox, etc.) and paste the shareable link here.
                </p>
              </div>
            </div>
          )}

          {/* Step 4: Review and Submit */}
          {currentStep === 4 && (
            <div className="space-y-6">
              <div>
                <h4 className="font-bold text-lg mb-2">Review Request</h4>
                <p className="text-sm text-ink-muted mb-4">
                  Please review details before submitting
                </p>
              </div>

              <div className="border border-hairline rounded-lg p-4">
                <div className="flex justify-between mb-2">
                  <span className="font-medium text-ink">Type</span>
                  <span className="capitalize">{requestType}</span>
                </div>
                <p className="font-medium text-ink mb-3">Items</p>
                <div className="space-y-2">
                  {Array.from(selectedItems.entries()).map(([itemId, selectedItem]) => {
                    const item = items.find(i => i._id === itemId);
                    if (!item) return null;
                    const productName = item.product?.name || item.name || 'Unknown Product';
                    return (
                      <div key={itemId} className="flex justify-between text-sm">
                        <span className="text-ink/80">{productName} × {selectedItem.quantity}</span>
                      </div>
                    );
                  })}
                  {requestType === 'return' && (
                    <div className="flex justify-between pt-2 border-t font-bold mt-2">
                      <span>Refund (Store Credit)</span>
                      <span className="text-gold">₹{calculateRefundAmount().toFixed(2)}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-start gap-3 p-4 bg-obsidian-deep rounded-lg">
                <input
                  type="checkbox"
                  id="policy"
                  checked={policyAccepted}
                  onChange={(e) => setPolicyAccepted(e.target.checked)}
                  className="h-5 w-5 text-gold rounded focus:ring-gold mt-0.5"
                />
                <label htmlFor="policy" className="text-sm text-ink/80 cursor-pointer">
                  I confirm that the items are in their original condition (unless defective) and I have read the return policy.
                </label>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="sticky bottom-0 bg-obsidian border-t p-6 flex justify-between z-10">
          <button
            onClick={currentStep === 1 ? onClose : handleBack}
            className="px-6 py-2 border border-hairline rounded-lg text-ink/80 font-medium hover:bg-obsidian-deep transition"
            disabled={isSubmitting}
          >
            {currentStep === 1 ? 'Cancel' : 'Back'}
          </button>
          
          <button
            onClick={currentStep === totalSteps ? handleSubmit : handleNext}
            disabled={isSubmitting}
            className={`px-6 py-2 rounded-lg text-ink font-medium transition flex items-center gap-2 ${
              isSubmitting ? 'bg-gold cursor-not-allowed' : 'bg-gold hover:opacity-90'
            }`}
          >
            {isSubmitting ? (
              <>
                <div className="w-4 h-4 border-2 border-hairline border-t-transparent rounded-full animate-spin"></div>
                Submitting...
              </>
            ) : currentStep === totalSteps ? (
              'Submit Request'
            ) : (
              <>
                Next <ChevronRight className="h-4 w-4" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
