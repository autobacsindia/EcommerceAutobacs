'use client';

import React, { useState } from 'react';
import { X, MapPin, Loader2, Navigation2, CheckCircle } from 'lucide-react';
import { useLocation } from '@/contexts/LocationContext';
import { LocationSelectRequest } from '@/types/location';
import toast from 'react-hot-toast';

interface LocationSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  onLocationSelected?: () => void;
}

export default function LocationSelector({
  isOpen,
  onClose,
  onLocationSelected,
}: LocationSelectorProps) {
  const { selectLocation, validateAddress, isLoading } = useLocation();
  const [step, setStep] = useState<'input' | 'confirm'>('input');
  const [pinCode, setPinCode] = useState('');
  const [validationResult, setValidationResult] = useState<any>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [useCurrentLocation, setUseCurrentLocation] = useState(false);

  if (!isOpen) return null;

  const handleClose = () => {
    setPinCode('');
    setValidationResult(null);
    setStep('input');
    setUseCurrentLocation(false);
    onClose();
  };

  const handleValidatePinCode = async () => {
    if (!pinCode || pinCode.length !== 6) {
      toast.error('Please enter a valid 6-digit PIN code');
      return;
    }

    try {
      setIsValidating(true);
      const result = await validateAddress(pinCode);
      
      if (result.serviceable) {
        setValidationResult(result);
        setStep('confirm');
      } else {
        toast.error(result.message || 'Delivery not available for this PIN code');
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to validate PIN code');
    } finally {
      setIsValidating(false);
    }
  };

  const handleConfirmLocation = async () => {
    try {
      // Use the zone data we got from validation to construct proper address
      let requestData: LocationSelectRequest;
      
      if (validationResult?.zone) {
        // Extract city and state from zone if available
        const city = validationResult.zone.cities?.[0] || 'Unknown';
        const state = validationResult.zone.states?.[0] || 'India';
        
        requestData = {
          address: {
            city,
            state,
            postalCode: pinCode,
            country: 'India',
          },
        };
      } else {
        // Fallback: just send postal code for backend to resolve
        requestData = {
          address: {
            postalCode: pinCode,
            country: 'India',
          },
        };
      }
      
      await selectLocation(requestData);
      
      toast.success('Location updated successfully!');
      onLocationSelected?.();
      handleClose();
    } catch (error: any) {
      toast.error(error.message || 'Failed to set location');
    }
  };

  const handleUseCurrentLocation = async () => {
    try {
      setUseCurrentLocation(true);
      
      // Get current coordinates
      const coords = await new Promise<GeolocationCoordinates>((resolve, reject) => {
        if (!navigator.geolocation) {
          reject(new Error('Geolocation not supported by your browser'));
          return;
        }

        navigator.geolocation.getCurrentPosition(
          (position) => resolve(position.coords),
          (error) => {
            let message = 'Failed to get location';
            switch (error.code) {
              case error.PERMISSION_DENIED:
                message = 'Location permission denied. Please enable location access.';
                break;
              case error.POSITION_UNAVAILABLE:
                message = 'Location information unavailable.';
                break;
              case error.TIMEOUT:
                message = 'Location request timed out.';
                break;
            }
            reject(new Error(message));
          },
          { enableHighAccuracy: true, timeout: 10000 }
        );
      });

      // Select location using coordinates
      await selectLocation({
        coordinates: {
          latitude: coords.latitude,
          longitude: coords.longitude,
        },
      });

      toast.success('Location detected successfully!');
      onLocationSelected?.();
      handleClose();
    } catch (error: any) {
      console.error('Current location error:', error);
      
      // Show user-friendly error message
      let errorMessage = error.message || 'Failed to detect location';
      
      // Check if it's a geocoding error
      if (errorMessage.includes('PIN code manually') || 
          errorMessage.includes('reverse geocode') ||
          errorMessage.includes('not configured')) {
        toast.error(
          'Unable to detect location automatically. Please enter your PIN code manually.',
          { duration: 4000 }
        );
      } else {
        toast.error(errorMessage);
      }
    } finally {
      setUseCurrentLocation(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 animate-fadeIn">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full animate-scaleIn">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            {step === 'input' ? 'Select Your Location' : 'Confirm Location'}
          </h2>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {step === 'input' ? (
            <div className="animate-fadeIn">
              {/* PIN Code Input */}
              <div className="mb-4">
                <label htmlFor="pincode" className="block text-sm font-medium text-gray-700 mb-2">
                  Enter PIN Code
                </label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                  <input
                    id="pincode"
                    type="text"
                    value={pinCode}
                    onChange={(e) => setPinCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="e.g., 400001"
                    className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    maxLength={6}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        handleValidatePinCode();
                      }
                    }}
                  />
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  Enter your 6-digit PIN code to check delivery availability
                </p>
              </div>

              <button
                onClick={handleValidatePinCode}
                disabled={isValidating || pinCode.length !== 6}
                className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              >
                {isValidating ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Checking...
                  </>
                ) : (
                  'Check Availability'
                )}
              </button>

              {/* Divider */}
              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-300"></div>
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-2 bg-white text-gray-500">Or</span>
                </div>
              </div>

              {/* Use Current Location */}
              <button
                onClick={handleUseCurrentLocation}
                disabled={useCurrentLocation}
                className="w-full border-2 border-blue-600 text-blue-600 py-3 rounded-lg font-medium hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              >
                {useCurrentLocation ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Detecting...
                  </>
                ) : (
                  <>
                    <Navigation2 className="h-5 w-5" />
                    Use My Current Location
                  </>
                )}
              </button>
            </div>
          ) : (
            <div className="animate-fadeIn">
              {/* Confirmation */}
              <div className="mb-6">
                <div className="flex items-start gap-3 p-4 bg-green-50 rounded-lg border border-green-200">
                  <CheckCircle className="h-6 w-6 text-green-600 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <h3 className="font-medium text-green-900 mb-1">
                      Delivery Available
                    </h3>
                    <p className="text-sm text-green-700">
                      {validationResult?.message}
                    </p>
                    {validationResult?.zone && (
                      <div className="mt-3 pt-3 border-t border-green-200">
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div>
                            <span className="text-green-600">Zone:</span>
                            <span className="ml-1 font-medium text-green-900">
                              {validationResult.zone.name}
                            </span>
                          </div>
                          <div>
                            <span className="text-green-600">Delivery:</span>
                            <span className="ml-1 font-medium text-green-900">
                              {validationResult.zone.deliveryTime.minDays}-
                              {validationResult.zone.deliveryTime.maxDays} days
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-600">
                    <span className="font-medium">PIN Code:</span> {pinCode}
                  </p>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setStep('input')}
                  className="flex-1 border border-gray-300 text-gray-700 py-3 rounded-lg font-medium hover:bg-gray-50 transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleConfirmLocation}
                  disabled={isLoading}
                  className="flex-1 bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin" />
                      Setting...
                    </>
                  ) : (
                    'Confirm Location'
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
