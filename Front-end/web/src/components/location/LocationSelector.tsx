'use client';

import React, { useState } from 'react';
import { X, Loader2, Navigation2, MapPin } from 'lucide-react';
import { useLocation } from '@/context/LocationContext';
import { LocationSelectRequest } from '@/types/location';
import toast from 'react-hot-toast';
import ManualLocationForm from './ManualLocationForm';

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
  const [retryCount, setRetryCount] = useState(0);
  const [showManualForm, setShowManualForm] = useState(false);
  const maxRetries = 3;

  if (!isOpen) return null;

  const handleClose = () => {
    setUseCurrentLocation(false);
    setRetryCount(0);
    setShowManualForm(false);
    onClose();
  };

  // Validate coordinates
  const isValidCoordinates = (latitude: number, longitude: number): boolean => {
    return (
      latitude >= -90 &&
      latitude <= 90 &&
      longitude >= -180 &&
      longitude <= 180
    );
  };

  const handleUseCurrentLocation = async (retryAttempt = 0) => {
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
          { 
            enableHighAccuracy: true, 
            timeout: 10000,
            maximumAge: retryAttempt > 0 ? 0 : 300000 // Force fresh data on retries
          }
        );
      });

      // Validate coordinates
      if (!isValidCoordinates(coords.latitude, coords.longitude)) {
        throw new Error('Invalid coordinates received from device.');
      }

      // Select location using coordinates
      await selectLocation({
        coordinates: {
          latitude: coords.latitude,
          longitude: coords.longitude,
        },
      });

      toast.success('Location detected successfully!');
      setRetryCount(0); // Reset retry count on success
      onLocationSelected?.();
      handleClose();
    } catch (error: any) {
      const message = error?.message || '';
      const isPermissionDeniedError = message.includes('Location permission denied');
      if (!isPermissionDeniedError) {
        console.error('Current location error:', error);
      }
      
      const isReverseGeocodeError = message.includes('Failed to reverse geocode coordinates');
      
      if (isReverseGeocodeError && retryAttempt < maxRetries) {
        const retryDelay = Math.pow(2, retryAttempt) * 1000;
        toast.loading(`Retrying... (${retryAttempt + 1}/${maxRetries})`);
        
        setTimeout(() => {
          toast.dismiss();
          handleUseCurrentLocation(retryAttempt + 1);
        }, retryDelay);
        
        setRetryCount(retryAttempt + 1);
        return;
      }
      
      let errorMessage = message || 'Failed to detect location';
      
      // Zone-not-found is no longer an error; backend always serviceable across India
      
      if (isReverseGeocodeError) {
        errorMessage = 'Unable to determine your address from location.';
        toast((t) => (
          <div className="flex flex-col space-y-2">
            <span>{errorMessage}</span>
            <div className="flex space-x-2 pt-1">
              <button 
                className="px-2 py-1 bg-gold text-obsidian text-xs rounded"
                onClick={() => {
                  toast.dismiss(t.id);
                  setShowManualForm(true);
                }}
              >
                Enter Manually
              </button>
              <button 
                className="px-2 py-1 bg-obsidian-raised text-ink text-xs rounded"
                onClick={() => toast.dismiss(t.id)}
              >
                Dismiss
              </button>
            </div>
          </div>
        ), { duration: 10000 });
        return;
      }

      if (isPermissionDeniedError) {
        toast((t) => (
          <div className="flex flex-col space-y-2">
            <span>
              Location access is blocked. Check your browser site settings AND your device/OS location privacy settings, then refresh — or enter your location manually.
            </span>
            <div className="flex space-x-2 pt-1">
              <button
                className="px-2 py-1 bg-gold text-obsidian text-xs rounded"
                onClick={() => {
                  toast.dismiss(t.id);
                  setShowManualForm(true);
                }}
              >
                Enter Manually
              </button>
              <button
                className="px-2 py-1 bg-obsidian-raised text-ink text-xs rounded"
                onClick={() => toast.dismiss(t.id)}
              >
                Dismiss
              </button>
            </div>
          </div>
        ), { duration: 10000 });
        setRetryCount(0);
        return;
      }
      
      toast.error(errorMessage);
      setRetryCount(0);
    } finally {
      if (retryCount === 0 || retryCount >= maxRetries) {
        setUseCurrentLocation(false);
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-obsidian-deep bg-opacity-50 z-50 flex items-center justify-center p-4 animate-fadeIn">
      <div className="bg-obsidian rounded-lg shadow-xl max-w-md w-full animate-scaleIn">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-hairline">
          <h2 className="text-lg font-semibold text-ink">
            Select Your Location
          </h2>
          <button
            onClick={handleClose}
            className="text-ink-muted hover:text-ink-muted transition-colors"
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
              <p className="text-center text-ink-muted mb-6">
                We use your location to show nearby stores and provide accurate delivery estimates.
              </p>
            </div>
            
            <div className="space-y-3">
              <button
                onClick={() => handleUseCurrentLocation()}
                disabled={useCurrentLocation}
                className="w-full bg-gold text-obsidian py-3 rounded-lg font-medium hover:bg-gold disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
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
              
              <div className="relative flex items-center justify-center">
                <div className="border-t border-hairline grow"></div>
                <span className="mx-4 text-ink-muted text-sm">OR</span>
                <div className="border-t border-hairline grow"></div>
              </div>
              
              <button
                onClick={() => setShowManualForm(true)}
                className="w-full border border-hairline text-ink/80 py-3 rounded-lg font-medium hover:bg-obsidian-deep transition-colors flex items-center justify-center gap-2"
              >
                <MapPin className="h-5 w-5" />
                Enter Location Manually
              </button>
            </div>
            
            <p className="mt-4 text-xs text-center text-ink-muted">
              🇮🇳 We deliver anywhere in India
            </p>
          </div>
        </div>
      </div>
      
      <ManualLocationForm 
        isOpen={showManualForm}
        onClose={() => setShowManualForm(false)}
        onLocationSelected={() => {
          setShowManualForm(false);
          onLocationSelected?.();
          handleClose();
        }}
      />
    </div>
  );
}
