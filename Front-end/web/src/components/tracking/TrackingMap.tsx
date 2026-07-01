'use client';

import { useEffect, useRef, useState } from 'react';
import { TrackingEvent, TrackingDestination } from '@/types/tracking';

interface TrackingMapProps {
  events: TrackingEvent[];
  destination: TrackingDestination;
  carrierName: string;
}

// Google Maps types
declare global {
  interface Window {
    google: any;
    initMap?: () => void;
  }
}

export function TrackingMap({ events, destination, carrierName }: TrackingMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [isLoadingMap, setIsLoadingMap] = useState(true);

  // Load Google Maps script
  useEffect(() => {
    const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    
    // Check if API key is configured
    if (!GOOGLE_MAPS_API_KEY || GOOGLE_MAPS_API_KEY === 'your_client_key_here') {
      setMapError('Map service not configured');
      setIsLoadingMap(false);
      return;
    }

    // Check if script already loaded
    if (window.google && window.google.maps) {
      setMapLoaded(true);
      setIsLoadingMap(false);
      return;
    }

    // Create script element
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=places`;
    script.async = true;
    script.defer = true;
    
    script.onload = () => {
      setMapLoaded(true);
      setIsLoadingMap(false);
    };
    
    script.onerror = () => {
      setMapError('Failed to load map service');
      setIsLoadingMap(false);
    };

    document.head.appendChild(script);

    return () => {
      // Cleanup if needed
    };
  }, []);

  // Initialize map when loaded
  useEffect(() => {
    if (!mapLoaded || !mapRef.current || mapInstanceRef.current) return;

    try {
      // Default center (India)
      const defaultCenter = { lat: 20.5937, lng: 78.9629 };
      
      // Initialize map
      const map = new window.google.maps.Map(mapRef.current, {
        center: defaultCenter,
        zoom: 5,
        mapTypeControl: true,
        streetViewControl: false,
        fullscreenControl: true
      });

      mapInstanceRef.current = map;

      // Plot markers and route
      plotTrackingData(map);
    } catch (error) {
      console.error('Error initializing map:', error);
      setMapError('Failed to initialize map');
    }
  }, [mapLoaded]);

  // Update map when events change
  useEffect(() => {
    if (mapInstanceRef.current && events.length > 0) {
      plotTrackingData(mapInstanceRef.current);
    }
  }, [events, destination]);

  const plotTrackingData = async (map: any) => {
    // Clear existing markers
    markersRef.current.forEach(marker => marker.setMap(null));
    markersRef.current = [];

    const bounds = new window.google.maps.LatLngBounds();
    const geocoder = new window.google.maps.Geocoder();
    const locations: any[] = [];

    // Geocode destination
    try {
      const destAddress = `${destination.city}, ${destination.state} ${destination.postalCode}, India`;
      const destResult = await geocodeAddress(geocoder, destAddress);
      
      if (destResult) {
        // Add destination marker
        const destMarker = new window.google.maps.Marker({
          position: destResult,
          map: map,
          title: 'Delivery Destination',
          icon: {
            path: window.google.maps.SymbolPath.CIRCLE,
            scale: 10,
            fillColor: '#10B981',
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 2
          },
          label: {
            text: 'D',
            color: '#ffffff',
            fontWeight: 'bold'
          }
        });

        const destInfoWindow = new window.google.maps.InfoWindow({
          content: `<div style="padding: 8px;"><strong>Destination</strong><br/>${destAddress}</div>`
        });

        destMarker.addListener('click', () => {
          destInfoWindow.open(map, destMarker);
        });

        markersRef.current.push(destMarker);
        bounds.extend(destResult);
        locations.push({ position: destResult, label: 'Destination' });
      }
    } catch (error) {
      console.error('Error geocoding destination:', error);
    }

    // Geocode event locations
    for (let i = 0; i < Math.min(events.length, 5); i++) {
      const event = events[i];
      if (!event.location) continue;

      try {
        const result = await geocodeAddress(geocoder, event.location + ', India');
        if (result) {
          const isCurrentLocation = i === 0;
          const marker = new window.google.maps.Marker({
            position: result,
            map: map,
            title: event.location,
            icon: {
              path: window.google.maps.SymbolPath.CIRCLE,
              scale: 8,
              fillColor: isCurrentLocation ? '#3B82F6' : '#6B7280',
              fillOpacity: 1,
              strokeColor: '#ffffff',
              strokeWeight: 2
            },
            animation: isCurrentLocation ? window.google.maps.Animation.BOUNCE : null
          });

          const infoWindow = new window.google.maps.InfoWindow({
            content: `
              <div style="padding: 8px;">
                <strong>${event.status.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}</strong><br/>
                <span style="color: #6B7280;">${event.location}</span><br/>
                <span style="font-size: 12px; color: #9CA3AF;">${new Date(event.timestamp).toLocaleString()}</span>
              </div>
            `
          });

          marker.addListener('click', () => {
            infoWindow.open(map, marker);
          });

          markersRef.current.push(marker);
          bounds.extend(result);
          locations.push({ position: result, label: event.location });
        }
      } catch (error) {
        console.error(`Error geocoding ${event.location}:`, error);
      }
    }

    // Fit map to bounds if we have locations
    if (locations.length > 0) {
      map.fitBounds(bounds);
      
      // Don't zoom in too much if only one location
      if (locations.length === 1) {
        const listener = window.google.maps.event.addListener(map, 'idle', () => {
          if (map.getZoom() > 12) map.setZoom(12);
          window.google.maps.event.removeListener(listener);
        });
      }

      // Draw route if we have multiple locations
      if (locations.length > 1) {
        const routePath = locations.map(loc => loc.position);
        const routeLine = new window.google.maps.Polyline({
          path: routePath,
          geodesic: true,
          strokeColor: '#3B82F6',
          strokeOpacity: 0.6,
          strokeWeight: 3,
          icons: [{
            icon: {
              path: window.google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
              scale: 3,
              strokeColor: '#3B82F6'
            },
            offset: '100%',
            repeat: '100px'
          }]
        });
        routeLine.setMap(map);
      }
    }
  };

  const geocodeAddress = (geocoder: any, address: string): Promise<any> => {
    return new Promise((resolve, reject) => {
      geocoder.geocode({ address }, (results: any[], status: string) => {
        if (status === 'OK' && results && results.length > 0) {
          resolve(results[0].geometry.location);
        } else {
          resolve(null);
        }
      });
    });
  };

  // Show loading state
  if (isLoadingMap) {
    return (
      <div className="w-full h-96 bg-obsidian-raised rounded-lg flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gold mx-auto"></div>
          <p className="mt-4 text-ink-muted">Loading map...</p>
        </div>
      </div>
    );
  }

  // Show error state with fallback
  if (mapError) {
    return (
      <div className="w-full bg-obsidian-deep rounded-lg p-6">
        <div className="flex items-start">
          <svg className="h-6 w-6 text-yellow-500 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div className="ml-3 flex-1">
            <h3 className="text-sm font-medium text-ink">Map Unavailable</h3>
            <p className="mt-1 text-sm text-ink-muted">Showing location information instead</p>
            
            <div className="mt-4 space-y-2">
              <div className="flex items-start">
                <svg className="w-5 h-5 text-green-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                </svg>
                <div>
                  <p className="font-medium text-ink">Destination</p>
                  <p className="text-sm text-ink-muted">{destination.city}, {destination.state} {destination.postalCode}</p>
                </div>
              </div>
              
              {events.slice(0, 3).map((event, index) => event.location && (
                <div key={index} className="flex items-start">
                  <svg className="w-5 h-5 text-gold mr-2" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                  </svg>
                  <div>
                    <p className="font-medium text-ink">{event.status.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}</p>
                    <p className="text-sm text-ink-muted">{event.location}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-ink">Package Location</h3>
        <span className="text-sm text-ink-muted">Via {carrierName}</span>
      </div>
      <div ref={mapRef} className="w-full h-96 rounded-lg shadow-sm" />
      <div className="mt-4 flex items-center text-sm text-ink-muted">
        <div className="flex items-center mr-4">
          <div className="w-3 h-3 rounded-full bg-gold mr-2"></div>
          <span>Current Location</span>
        </div>
        <div className="flex items-center">
          <div className="w-3 h-3 rounded-full bg-green-500 mr-2"></div>
          <span>Destination</span>
        </div>
      </div>
    </div>
  );
}
