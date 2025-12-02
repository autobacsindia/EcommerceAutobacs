'use client';

import React from 'react';
import { Package, Truck, Clock } from 'lucide-react';
import { useLocation } from '@/contexts/LocationContext';
import { locationService } from '@/services/locationService';

interface DeliveryEstimateProps {
  productId?: string;
  postalCode?: string;
  className?: string;
  showIcon?: boolean;
  compact?: boolean;
}

export default function DeliveryEstimate({
  productId,
  postalCode,
  className = '',
  showIcon = true,
  compact = false,
}: DeliveryEstimateProps) {
  const { currentLocation, deliveryZone, deliveryEstimate } = useLocation();
  const [estimate, setEstimate] = React.useState<any>(null);
  const [isLoading, setIsLoading] = React.useState(false);

  React.useEffect(() => {
    // Use location context if available
    if (deliveryZone && !postalCode) {
      return;
    }

    // Fetch estimate for specific postal code
    if (postalCode) {
      fetchEstimate(postalCode);
    }
  }, [postalCode, deliveryZone]);

  const fetchEstimate = async (pinCode: string) => {
    try {
      setIsLoading(true);
      const result = await locationService.getDeliveryEstimate({ pinCode });
      setEstimate(result);
    } catch (error) {
      console.error('Failed to fetch delivery estimate:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const getDeliveryInfo = () => {
    if (estimate) {
      return {
        zone: estimate.zone,
        days: estimate.deliveryDays,
        range: estimate.estimate?.formattedRange,
      };
    }

    if (deliveryZone) {
      const days = locationService.formatDeliveryEstimate(
        deliveryZone.deliveryTime.minDays,
        deliveryZone.deliveryTime.maxDays
      );
      const range = deliveryEstimate?.formattedRange;
      
      return {
        zone: { name: deliveryZone.name, type: deliveryZone.type },
        days,
        range,
      };
    }

    return null;
  };

  const deliveryInfo = getDeliveryInfo();

  if (!deliveryInfo && !currentLocation) {
    return null;
  }

  if (isLoading) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        {showIcon && <Clock className="h-4 w-4 text-gray-400 animate-pulse" />}
        <span className="text-sm text-gray-400">Checking delivery...</span>
      </div>
    );
  }

  if (!deliveryInfo) {
    return null;
  }

  const zoneColor = locationService.getZoneBadgeColor(deliveryInfo.zone.type);

  if (compact) {
    return (
      <div className={`inline-flex items-center gap-1.5 ${className}`}>
        {showIcon && <Truck className="h-4 w-4 text-green-600" />}
        <span className="text-sm font-medium text-green-700">
          {deliveryInfo.days}
        </span>
      </div>
    );
  }

  return (
    <div className={`delivery-estimate ${className}`}>
      <div className="space-y-2">
        {/* Delivery Time */}
        <div className="flex items-center gap-2">
          {showIcon && <Truck className="h-5 w-5 text-green-600" />}
          <div>
            <p className="text-sm font-medium text-gray-900">
              Delivery: <span className="text-green-700">{deliveryInfo.days}</span>
            </p>
            {deliveryInfo.range && (
              <p className="text-xs text-gray-500">
                Expected {deliveryInfo.range}
              </p>
            )}
          </div>
        </div>

        {/* Zone Badge */}
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${zoneColor}`}>
            {locationService.getZoneTypeDisplay(deliveryInfo.zone.type)} Zone
          </span>
          
          {currentLocation && (
            <span className="text-xs text-gray-500">
              to {currentLocation.selectedAddress.city}, {currentLocation.selectedAddress.postalCode}
            </span>
          )}
        </div>

        {/* Product availability hint */}
        {productId && (
          <div className="flex items-center gap-1.5 text-xs text-green-700">
            <Package className="h-3.5 w-3.5" />
            <span>Available for delivery</span>
          </div>
        )}
      </div>
    </div>
  );
}
