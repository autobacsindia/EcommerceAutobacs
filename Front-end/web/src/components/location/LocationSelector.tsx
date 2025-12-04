'use client';

import React, { useState } from 'react';
import { X, Loader2, Navigation2 } from 'lucide-react';
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
  const { selectLocation, isLoading } = useLocation();
  const [useCurrentLocation, setUseCurrentLocation] = useState(false);

  if (!isOpen) return null;

  const handleClose = () => {
    setUseCurrentLocation(false);
    onClose();
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
      
      toast.error(errorMessage);
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
            Select Your Location
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
          <div className="animate-fadeIn">
            {/* Use Current Location */}
            <div className="mb-4">
              <p className="text-center text-gray-600 mb-6">
                We use your location to show nearby stores and provide accurate delivery estimates.
              </p>
            </div>
            
            <button
              onClick={handleUseCurrentLocation}
              disabled={useCurrentLocation}
              className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {useCurrentLocation ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Detecting Location...
                </>
              ) : (
                <>
                  <Navigation2 className="h-5 w-5" />
                  Use My Current Location
                </>
              )}
            </button>
            
            <p className="mt-4 text-xs text-center text-gray-500">
              🇮🇳 We deliver anywhere in India
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
