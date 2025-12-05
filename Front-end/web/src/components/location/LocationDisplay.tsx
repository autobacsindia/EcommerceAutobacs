'use client';

import React, { useState } from 'react';
import { MapPin, ChevronDown, Navigation } from 'lucide-react';
import { useLocation, useLocationDisplay } from '@/contexts/LocationContext';
import LocationSelector from './LocationSelector';
import LocationHistory from './LocationHistory';
import { LocationHistoryItem } from '@/utils/locationHistory';
import { addToLocationHistory } from '@/utils/locationHistory';
import toast from 'react-hot-toast';

interface LocationDisplayProps {
  compact?: boolean;
  showChangeButton?: boolean;
  className?: string;
}

export default function LocationDisplay({
  compact = false,
  showChangeButton = true,
  className = '',
}: LocationDisplayProps) {
  const { currentLocation, deliveryZone, isLoading, selectLocation } = useLocation();
  const { locationText, deliveryText, hasLocation } = useLocationDisplay();
  const [showSelector, setShowSelector] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const handleOpenSelector = () => {
    setShowHistory(false);
    setShowSelector(true);
  };

  const handleCloseSelector = () => {
    setShowSelector(false);
  };

  const handleToggleHistory = () => {
    setShowHistory(!showHistory);
  };

  const handleCloseHistory = () => {
    setShowHistory(false);
  };

  const handleSelectFromHistory = async (item: LocationHistoryItem) => {
    try {
      await selectLocation({
        address: {
          city: item.address.city,
          state: item.address.state,
          postalCode: item.address.postalCode,
          country: item.address.country,
        },
      });
      toast.success('Location updated successfully!');
      handleCloseHistory();
    } catch (error: any) {
      toast.error(error.message || 'Failed to update location');
    }
  };

  const handleLocationSelected = () => {
    // Add to history when location is selected
    if (currentLocation) {
      addToLocationHistory(currentLocation);
    }
  };

  if (isLoading && !currentLocation) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <MapPin className="h-4 w-4 text-gray-400 animate-pulse" />
        <span className="text-sm text-gray-400">Loading...</span>
      </div>
    );
  }

  return (
    <>
      <div className={`location-display relative ${className}`}>
        {compact ? (
          // Compact version for header with history dropdown
          <div className="relative">
            <button
              onClick={handleToggleHistory}
              className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-800 transition-colors group"
              aria-label="Change delivery location"
            >
              <MapPin className="h-4 w-4 text-green-400 flex-shrink-0" />
              <div className="flex flex-col items-start min-w-0">
                <span className="text-xs text-gray-300">Deliver to</span>
                <div className="flex items-center gap-1">
                  <span className="text-sm font-medium text-white truncate max-w-[150px]">
                    {locationText}
                  </span>
                  <ChevronDown className="h-3 w-3 text-gray-300 flex-shrink-0" />
                </div>
              </div>
            </button>
            
            {/* History Dropdown */}
            <LocationHistory
              isOpen={showHistory}
              onClose={handleCloseHistory}
              onSelectLocation={handleSelectFromHistory}
              onOpenSelector={handleOpenSelector}
            />
          </div>
        ) : (
          // Full version for dedicated location sections
          <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3">
                <div className="mt-1">
                  <MapPin className="h-5 w-5 text-blue-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-medium text-gray-700 mb-1">
                    Delivery Location
                  </h3>
                  {hasLocation ? (
                    <>
                      <p className="text-base font-semibold text-gray-900 mb-1">
                        {currentLocation?.selectedAddress.city}, {currentLocation?.selectedAddress.state}
                      </p>
                      <p className="text-sm text-gray-600">
                        PIN: {currentLocation?.selectedAddress.postalCode}
                      </p>
                      {deliveryZone && deliveryText && (
                        <div className="mt-2 inline-flex items-center gap-2 px-2 py-1 bg-green-50 text-green-700 rounded text-xs font-medium">
                          <Navigation className="h-3 w-3" />
                          Delivers in {deliveryText}
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-gray-500">
                      Select a location to see delivery options
                    </p>
                  )}
                </div>
              </div>
              {showChangeButton && (
                <button
                  onClick={handleOpenSelector}
                  className="text-sm font-medium text-blue-600 hover:text-blue-700 whitespace-nowrap"
                >
                  {hasLocation ? 'Change' : 'Select'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Location Selector Modal */}
      <LocationSelector
        isOpen={showSelector}
        onClose={handleCloseSelector}
        onLocationSelected={handleLocationSelected}
      />
    </>
  );
}
