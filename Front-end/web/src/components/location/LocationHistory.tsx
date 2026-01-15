'use client';

import React, { useState, useEffect, useRef } from 'react';
import { MapPin, ChevronDown, CheckCircle, Clock, X } from 'lucide-react';
import { useLocation } from '@/contexts/LocationContext';
import { getLocationHistory, markCurrentLocation, removeFromHistory } from '@/utils/locationHistory';
import { LocationHistoryItem } from '@/utils/locationHistory';
import locationService from '@/services/locationService';

interface LocationHistoryProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectLocation: (item: LocationHistoryItem) => void;
  onOpenSelector?: () => void;
}

export default function LocationHistory({
  isOpen,
  onClose,
  onSelectLocation,
  onOpenSelector,
}: LocationHistoryProps) {
  const { currentLocation } = useLocation();
  const [history, setHistory] = useState<LocationHistoryItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const ownerId = currentLocation?.user || currentLocation?.sessionId || null;

  useEffect(() => {
    if (isOpen) {
      loadHistory();
      setSelectedIndex(-1);
    }
  }, [isOpen, currentLocation]);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          setSelectedIndex((prev) => (prev < history.length - 1 ? prev + 1 : prev));
          break;
        case 'ArrowUp':
          event.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : -1));
          break;
        case 'Enter':
          event.preventDefault();
          if (selectedIndex >= 0 && selectedIndex < history.length) {
            const item = history[selectedIndex];
            if (!item.isCurrent) {
              onSelectLocation(item);
            }
          }
          break;
        case 'Escape':
          event.preventDefault();
          onClose();
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, history, selectedIndex, onSelectLocation, onClose]);

  const loadHistory = () => {
    const historyItems = getLocationHistory(ownerId);
    const currentPostalCode = currentLocation?.selectedAddress.postalCode;
    const markedHistory = currentPostalCode
      ? markCurrentLocation(currentPostalCode, ownerId)
      : historyItems;
    setHistory(markedHistory);
  };

  const handleSelectItem = (item: LocationHistoryItem) => {
    if (item.isCurrent) return;
    onSelectLocation(item);
  };

  const handleRemoveItem = (event: React.MouseEvent<HTMLSpanElement>, itemId: string) => {
    event.stopPropagation();
    removeFromHistory(itemId, ownerId);
    loadHistory();
  };

  const formatTimeAgo = (timestamp: string): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 60) {
      return `${diffMins}m ago`;
    } else if (diffHours < 24) {
      return `${diffHours}h ago`;
    } else if (diffDays < 7) {
      return `${diffDays}d ago`;
    } else {
      return date.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
    }
  };

  if (!isOpen) return null;

  return (
    <div
      ref={dropdownRef}
      className="absolute top-full left-0 mt-2 w-80 bg-white border border-gray-200 rounded-lg shadow-lg z-50 animate-slideDown"
      role="menu"
      aria-label="Recent locations"
    >
      <div className="px-4 py-3 border-b border-gray-200">
        <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
          <Clock className="h-4 w-4" />
          Recent Locations
        </h3>
      </div>

      <div className="max-h-80 overflow-y-auto">
        {history.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <MapPin className="h-10 w-10 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-500 mb-1">No recent locations</p>
            <p className="text-xs text-gray-400 mb-4">Select a location to get started</p>
            {onOpenSelector && (
              <button
                onClick={() => {
                  onClose();
                  onOpenSelector();
                }}
                className="text-sm text-blue-600 hover:text-blue-700 font-medium"
              >
                Select Location
              </button>
            )}
          </div>
        ) : (
          <div className="py-2">
            {history.map((item, index) => {
              const isCurrent = item.isCurrent;
              const isSelected = index === selectedIndex;
              const zoneColor = item.deliveryZone
                ? locationService.getZoneBadgeColor(item.deliveryZone.type)
                : '';

              return (
                <button
                  key={item.id}
                  onClick={() => handleSelectItem(item)}
                  disabled={isCurrent}
                  className={`w-full px-4 py-3 text-left transition-colors ${
                    isCurrent
                      ? 'bg-blue-50 cursor-default'
                      : isSelected
                      ? 'bg-gray-100'
                      : 'hover:bg-gray-50'
                  } ${index !== history.length - 1 ? 'border-b border-gray-100' : ''}`}
                  role="menuitem"
                  aria-current={isCurrent ? 'location' : undefined}
                >
                  <div className="flex items-start gap-3">
                    <MapPin
                      className={`h-5 w-5 flex-shrink-0 mt-0.5 ${
                        isCurrent ? 'text-blue-600' : 'text-gray-400'
                      }`}
                    />

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <p
                          className={`text-sm font-medium truncate ${
                            isCurrent ? 'text-blue-900' : 'text-gray-900'
                          }`}
                        >
                          {item.address.city}, {item.address.state}
                        </p>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {isCurrent && (
                            <CheckCircle className="h-4 w-4 text-blue-600 flex-shrink-0" />
                          )}
                          {!isCurrent && (
                            <span
                              onClick={(event) => handleRemoveItem(event, item.id)}
                              className="text-gray-400 hover:text-red-600 cursor-pointer p-1"
                              aria-label="Remove saved location"
                            >
                              <X className="h-4 w-4" />
                            </span>
                          )}
                        </div>
                      </div>

                      <p className="text-xs text-gray-500 mb-2">
                        PIN: {item.address.postalCode}
                      </p>

                      <div className="flex items-center gap-2">
                        {item.deliveryZone && (
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${zoneColor}`}
                          >
                            {locationService.getZoneTypeDisplay(item.deliveryZone.type)}
                          </span>
                        )}
                        <span className="text-xs text-gray-400">
                          {formatTimeAgo(item.timestamp)}
                        </span>
                      </div>

                      {isCurrent && (
                        <p className="text-xs text-blue-600 font-medium mt-1">
                          Current location
                        </p>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {history.length > 0 && onOpenSelector && (
        <div className="px-4 py-3 border-t border-gray-200">
          <button
            onClick={() => {
              onClose();
              onOpenSelector();
            }}
            className="w-full px-4 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
          >
            Enter Different Location
          </button>
        </div>
      )}
    </div>
  );
}
