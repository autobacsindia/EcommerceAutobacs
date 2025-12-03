'use client';

import { useState } from 'react';
import { X, CheckCircle, ChevronRight, ChevronLeft, AlertCircle } from 'lucide-react';
import apiClient from '@/lib/api';
import { API_ENDPOINTS, RETURN_REASONS, RETURN_POLICY_POINTS } from '@/lib/constants';
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
  const [returnReason, setReturnReason] = useState('');
  const [description, setDescription] = useState('');
  const [images, setImages] = useState<UploadedImage[]>([]);
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
  if (daysSinceDelivery > 30) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-lg max-w-md w-full p-6">
          <div className="flex items-center justify-center mb-4">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center">
              <AlertCircle className="h-10 w-10 text-red-600" />
            </div>
          </div>
          <h3 className="text-xl font-bold text-center mb-2">Return Window Expired</h3>
          <p className="text-gray-600 text-center mb-6">
            Returns must be requested within 30 days of delivery. Your order was delivered {daysSinceDelivery} days ago.
          </p>
          <button
            onClick={onClose}
            className="w-full bg-blue-600 text-white px-4 py-3 rounded-lg hover:bg-blue-700 font-medium transition"
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
        if (['defective', 'wrong_item', 'not_as_described', 'other'].includes(returnReason) && !description.trim()) {
          return 'Please describe the issue';
        }
        if (description.length > 1000) {
          return 'Description cannot exceed 1000 characters';
        }
        break;
      case 3:
        // Images are optional
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
        product: selectedItem.productId,
        quantity: selectedItem.quantity,
        reason: selectedItem.reason || returnReason,
      }));

      const payload = {
        items: itemsToReturn,
        reason: returnReason,
        description: description.trim() || undefined,
        images: images.length > 0 ? images : undefined,
      };

      const response: Record<string, any> = await apiClient.post(API_ENDPOINTS.ORDER_RETURN(orderId), payload);
      
      setSuccess({
        returnRequestId: response.returnRequest?._id || 'N/A',
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
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
          <div className="p-6">
            <div className="flex justify-center mb-4">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
                <CheckCircle className="h-10 w-10 text-green-600" />
              </div>
            </div>

            <h3 className="text-2xl font-bold text-center mb-2">Return Request Submitted</h3>
            <p className="text-gray-600 text-center mb-4">
              Your return request for order #{orderNumber} has been submitted successfully.
            </p>

            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-6">
              <p className="text-sm font-medium text-gray-700 mb-1">Return Request ID</p>
              <p className="text-lg font-mono font-bold">{success.returnRequestId}</p>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
              <p className="text-sm font-medium text-blue-900 mb-3">What happens next:</p>
              <ul className="space-y-2 text-sm text-blue-800">
                <li className="flex gap-2">
                  <span className="text-blue-600 font-bold">1.</span>
                  <span>We'll review your request within 24-48 hours</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-blue-600 font-bold">2.</span>
                  <span>You'll receive an email if your return is approved</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-blue-600 font-bold">3.</span>
                  <span>A prepaid return shipping label will be provided</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-blue-600 font-bold">4.</span>
                  <span>Refund will be processed after we receive and inspect the items</span>
                </li>
              </ul>
            </div>

            <div className="flex flex-col gap-3">
              <button
                onClick={() => {
                  onSuccess();
                  onClose();
                }}
                className="w-full bg-blue-600 text-white px-4 py-3 rounded-lg hover:bg-blue-700 font-medium transition"
              >
                View Return Status
              </button>
              <button
                onClick={onClose}
                className="w-full border border-gray-300 text-gray-700 px-4 py-3 rounded-lg hover:bg-gray-50 font-medium transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b z-10">
          <div className="flex items-center justify-between p-6">
            <div>
              <h3 className="text-2xl font-bold">Request Return</h3>
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

          {/* Progress Indicator */}
          <div className="px-6 pb-4">
            <div className="flex items-center justify-between mb-2">
              {[1, 2, 3, 4].map((step) => (
                <div key={step} className="flex items-center flex-1">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                      step <= currentStep
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-200 text-gray-600'
                    }`}
                  >
                    {step}
                  </div>
                  {step < 4 && (
                    <div
                      className={`flex-1 h-1 mx-2 ${
                        step < currentStep ? 'bg-blue-600' : 'bg-gray-200'
                      }`}
                    />
                  )}
                </div>
              ))}
            </div>
            <div className="flex justify-between text-xs text-gray-600">
              <span>Select Items</span>
              <span>Reason</span>
              <span>Images</span>
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

          {/* Step 1: Select Items */}
          {currentStep === 1 && (
            <div className="space-y-4">
              <div>
                <h4 className="font-bold text-lg mb-2">Select Items to Return</h4>
                <p className="text-sm text-gray-600 mb-4">
                  Choose which items you'd like to return and specify the quantity
                </p>
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
                          <label className="text-sm font-medium text-gray-700">Quantity to return:</label>
                          <div className="flex items-center border border-gray-300 rounded-lg overflow-hidden">
                            <button
                              type="button"
                              onClick={() => handleQuantityChange(item._id, Math.max(1, selectedItem.quantity - 1))}
                              className="px-3 py-1 bg-gray-100 hover:bg-gray-200 transition"
                            >
                              -
                            </button>
                            <span className="px-4 py-1 min-w-[3rem] text-center">{selectedItem.quantity}</span>
                            <button
                              type="button"
                              onClick={() => handleQuantityChange(item._id, Math.min(item.quantity, selectedItem.quantity + 1))}
                              className="px-3 py-1 bg-gray-100 hover:bg-gray-200 transition"
                            >
                              +
                            </button>
                          </div>
                          <span className="text-sm text-gray-500">of {item.quantity} available</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {selectedItems.size > 0 && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mt-4">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-sm font-medium text-blue-900">
                        {selectedItems.size} item{selectedItems.size > 1 ? 's' : ''} selected for return
                      </p>
                      <p className="text-xs text-blue-700 mt-1">
                        Estimated refund: ₹{calculateRefundAmount().toFixed(2)}
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-blue-600 mt-2">
                    * Shipping costs are typically not refunded
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Step 2: Reason and Details */}
          {currentStep === 2 && (
            <div className="space-y-6">
              <div>
                <h4 className="font-bold text-lg mb-2">Reason for Return</h4>
                <p className="text-sm text-gray-600 mb-4">
                  Please tell us why you're returning these items
                </p>
              </div>

              <div className="space-y-3">
                {RETURN_REASONS.map((reason) => (
                  <label
                    key={reason.value}
                    className={`flex flex-col p-4 border rounded-lg cursor-pointer transition ${
                      returnReason === reason.value
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-300 hover:border-gray-400'
                    }`}
                  >
                    <div className="flex items-start">
                      <input
                        type="radio"
                        name="returnReason"
                        value={reason.value}
                        checked={returnReason === reason.value}
                        onChange={(e) => setReturnReason(e.target.value)}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 mt-1"
                      />
                      <div className="ml-3 flex-1">
                        <span className="font-medium text-gray-900">{reason.label}</span>
                        <p className="text-sm text-gray-600 mt-1">{reason.description}</p>
                      </div>
                    </div>
                  </label>
                ))}
              </div>

              {/* Description (required for some reasons) */}
              {returnReason && (
                <div>
                  <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-2">
                    Describe the issue {['defective', 'wrong_item', 'not_as_described', 'other'].includes(returnReason) && (
                      <span className="text-red-500">*</span>
                    )}
                  </label>
                  <textarea
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={
                      returnReason === 'defective'
                        ? 'Please describe the defect or damage...'
                        : returnReason === 'wrong_item'
                        ? 'What did you receive vs. what you ordered?'
                        : returnReason === 'not_as_described'
                        ? 'How does the item differ from the description?'
                        : 'Please provide additional details...'
                    }
                    rows={5}
                    maxLength={1000}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  />
                  <div className="flex justify-between mt-2">
                    <p className="text-xs text-gray-500">
                      {['defective', 'wrong_item', 'not_as_described', 'other'].includes(returnReason)
                        ? 'Required - Please provide details'
                        : 'Optional'}
                    </p>
                    <p className="text-xs text-gray-500">{description.length}/1000</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 3: Upload Images */}
          {currentStep === 3 && (
            <div className="space-y-4">
              <div>
                <h4 className="font-bold text-lg mb-2">Upload Images (Optional)</h4>
                <p className="text-sm text-gray-600 mb-4">
                  Clear photos help us process your return faster
                </p>
              </div>

              <ImageUploader images={images} onImagesChange={setImages} />
            </div>
          )}

          {/* Step 4: Review and Submit */}
          {currentStep === 4 && (
            <div className="space-y-6">
              <div>
                <h4 className="font-bold text-lg mb-2">Review Your Return Request</h4>
                <p className="text-sm text-gray-600 mb-4">
                  Please review all details before submitting
                </p>
              </div>

              {/* Items Summary */}
              <div className="border border-gray-300 rounded-lg p-4">
                <p className="font-medium text-gray-900 mb-3">Items to Return</p>
                <div className="space-y-2">
                  {Array.from(selectedItems.entries()).map(([itemId, selectedItem]) => {
                    const item = items.find(i => i._id === itemId);
                    if (!item) return null;
                    const productName = item.product?.name || item.name || 'Unknown Product';
                    return (
                      <div key={itemId} className="flex justify-between text-sm">
                        <span className="text-gray-700">{productName} × {selectedItem.quantity}</span>
                        <span className="font-medium">₹{(item.price * selectedItem.quantity).toFixed(2)}</span>
                      </div>
                    );
                  })}
                  <div className="flex justify-between pt-2 border-t font-bold">
                    <span>Estimated Refund</span>
                    <span className="text-blue-600">₹{calculateRefundAmount().toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Reason and Description */}
              <div className="border border-gray-300 rounded-lg p-4">
                <p className="font-medium text-gray-900 mb-2">Return Reason</p>
                <p className="text-sm text-gray-700">
                  {RETURN_REASONS.find(r => r.value === returnReason)?.label}
                </p>
                {description && (
                  <>
                    <p className="font-medium text-gray-900 mt-3 mb-2">Description</p>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap">{description}</p>
                  </>
                )}
              </div>

              {/* Images Count */}
              {images.length > 0 && (
                <div className="border border-gray-300 rounded-lg p-4">
                  <p className="font-medium text-gray-900 mb-2">Supporting Images</p>
                  <p className="text-sm text-gray-700">{images.length} image{images.length > 1 ? 's' : ''} uploaded</p>
                </div>
              )}

              {/* Return Policy */}
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <p className="font-medium text-yellow-900 mb-3">Return Policy</p>
                <ul className="space-y-2 text-sm text-yellow-800">
                  {RETURN_POLICY_POINTS.map((point, index) => (
                    <li key={index} className="flex gap-2">
                      <span>•</span>
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Policy Agreement */}
              <label className="flex items-start gap-3 cursor-pointer p-4 border-2 border-gray-300 rounded-lg hover:bg-gray-50 transition">
                <input
                  type="checkbox"
                  checked={policyAccepted}
                  onChange={(e) => setPolicyAccepted(e.target.checked)}
                  className="h-5 w-5 text-blue-600 focus:ring-blue-500 rounded mt-0.5"
                />
                <span className="text-sm text-gray-700">
                  I have read and agree to the return policy. I understand that items must be in original condition for return.
                </span>
              </label>
            </div>
          )}

          {/* Navigation Buttons */}
          <div className="flex flex-col-reverse sm:flex-row gap-3 mt-8">
            {currentStep > 1 && (
              <button
                type="button"
                onClick={handleBack}
                disabled={isSubmitting}
                className="flex-1 flex items-center justify-center gap-2 px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="h-5 w-5" />
                Back
              </button>
            )}

            {currentStep < totalSteps ? (
              <button
                type="button"
                onClick={handleNext}
                className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition"
              >
                Continue
                <ChevronRight className="h-5 w-5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isSubmitting || !policyAccepted}
                className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                    <span>Submitting...</span>
                  </>
                ) : (
                  'Submit Return Request'
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
