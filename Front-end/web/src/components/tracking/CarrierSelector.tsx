'use client';

import { useState, useEffect } from 'react';
import { CarrierInfo } from '@/types/tracking';
import trackingService from '@/services/trackingService';

interface CarrierSelectorProps {
  onCarrierSelect: (carrierCode: string) => void;
  selectedCarrier?: string;
}

export function CarrierSelector({ onCarrierSelect, selectedCarrier }: CarrierSelectorProps) {
  const [carriers, setCarriers] = useState<CarrierInfo[]>([]);
  const [filteredCarriers, setFilteredCarriers] = useState<CarrierInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterBy, setFilterBy] = useState<'all' | 'fastest' | 'international'>('all');

  useEffect(() => {
    loadCarriers();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [carriers, searchQuery, filterBy]);

  const loadCarriers = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await trackingService.getCarriers();
      if (response.success && response.carriers) {
        setCarriers(response.carriers);
      } else {
        setError('Failed to load carriers');
      }
    } catch (err: any) {
      console.error('Load carriers error:', err);
      setError(err.message || 'Failed to load carriers');
    } finally {
      setLoading(false);
    }
  };

  const applyFilters = () => {
    let result = [...carriers];

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(carrier =>
        carrier.name.toLowerCase().includes(query) ||
        carrier.code.toLowerCase().includes(query)
      );
    }

    // Apply category filter
    if (filterBy === 'fastest') {
      result = result.sort((a, b) => a.estimatedDeliveryDays - b.estimatedDeliveryDays).slice(0, 5);
    } else if (filterBy === 'international') {
      result = result.filter(carrier =>
        ['FEDEX', 'UPS', 'DHL', 'USPS'].includes(carrier.code)
      );
    }

    setFilteredCarriers(result);
  };

  const handleCarrierClick = (carrierCode: string) => {
    onCarrierSelect(carrierCode);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <span className="ml-3 text-gray-600">Loading carriers...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <div className="flex">
          <svg className="h-5 w-5 text-red-400" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
          </svg>
          <div className="ml-3">
            <p className="text-sm text-red-700">{error}</p>
            <button
              onClick={loadCarriers}
              className="mt-2 text-sm font-medium text-red-700 hover:text-red-600"
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search and Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <input
            type="text"
            placeholder="Search carriers..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setFilterBy('all')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              filterBy === 'all'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            All
          </button>
          <button
            onClick={() => setFilterBy('fastest')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              filterBy === 'fastest'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Fastest
          </button>
          <button
            onClick={() => setFilterBy('international')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              filterBy === 'international'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            International
          </button>
        </div>
      </div>

      {/* Carriers Grid */}
      {filteredCarriers.length === 0 ? (
        <div className="text-center py-12">
          <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="mt-2 text-gray-600">No carriers found matching your search</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredCarriers.map((carrier) => (
            <button
              key={carrier.code}
              onClick={() => handleCarrierClick(carrier.code)}
              className={`p-4 border-2 rounded-lg text-left transition-all hover:shadow-md ${
                selectedCarrier === carrier.code
                  ? 'border-blue-600 bg-blue-50'
                  : 'border-gray-200 hover:border-blue-300'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-900">{carrier.name}</h3>
                  <p className="text-sm text-gray-500 mt-1">Code: {carrier.code}</p>
                  <div className="mt-2 flex items-center">
                    <svg className="w-4 h-4 text-gray-400 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="text-sm text-gray-600">
                      {carrier.estimatedDeliveryDays} {carrier.estimatedDeliveryDays === 1 ? 'day' : 'days'}
                    </span>
                  </div>
                </div>
                {selectedCarrier === carrier.code && (
                  <div className="flex-shrink-0">
                    <svg className="w-6 h-6 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Selected Carrier Info */}
      {selectedCarrier && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-start">
            <svg className="h-5 w-5 text-blue-600 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            <div className="ml-3">
              <p className="text-sm text-blue-700">
                <span className="font-medium">
                  {carriers.find(c => c.code === selectedCarrier)?.name}
                </span> selected. 
                The tracking number will be auto-generated when you add tracking to the order.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
