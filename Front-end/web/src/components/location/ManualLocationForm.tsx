'use client';

import React, { useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { useLocation } from '@/contexts/LocationContext';
import toast from 'react-hot-toast';

interface ManualLocationFormProps {
  isOpen: boolean;
  onClose: () => void;
  onLocationSelected?: () => void;
}

export default function ManualLocationForm({
  isOpen,
  onClose,
  onLocationSelected,
}: ManualLocationFormProps) {
  const { selectLocation, isLoading } = useLocation();
  const [formData, setFormData] = useState({
    city: '',
    state: '',
    postalCode: '',
    country: 'India',
  });

  if (!isOpen) return null;

  const handleClose = () => {
    setFormData({
      city: '',
      state: '',
      postalCode: '',
      country: 'India',
    });
    onClose();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const validateForm = () => {
    if (!formData.city.trim()) {
      toast.error('Please enter a city');
      return false;
    }
    
    if (!formData.state.trim()) {
      toast.error('Please enter a state');
      return false;
    }
    
    if (!formData.postalCode.trim()) {
      toast.error('Please enter a postal code');
      return false;
    }
    
    // Basic postal code validation for India (6 digits)
    if (!/^\d{6}$/.test(formData.postalCode)) {
      toast.error('Please enter a valid 6-digit postal code');
      return false;
    }
    
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }
    
    try {
      await selectLocation({
        address: {
          city: formData.city,
          state: formData.state,
          postalCode: formData.postalCode,
          country: formData.country,
        }
      });
      
      toast.success('Location saved successfully!');
      onLocationSelected?.();
      handleClose();
    } catch (error: any) {
      console.error('Manual location error:', error);
      toast.error(error.message || 'Failed to save location');
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 animate-fadeIn">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full animate-scaleIn">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            Enter Your Location
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
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="city" className="block text-sm font-medium text-gray-700 mb-1">
                City *
              </label>
              <input
                type="text"
                id="city"
                name="city"
                value={formData.city}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Enter your city"
                required
              />
            </div>
            
            <div>
              <label htmlFor="state" className="block text-sm font-medium text-gray-700 mb-1">
                State *
              </label>
              <input
                type="text"
                id="state"
                name="state"
                value={formData.state}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Enter your state"
                required
              />
            </div>
            
            <div>
              <label htmlFor="postalCode" className="block text-sm font-medium text-gray-700 mb-1">
                Postal Code *
              </label>
              <input
                type="text"
                id="postalCode"
                name="postalCode"
                value={formData.postalCode}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Enter 6-digit postal code"
                maxLength={6}
                required
              />
            </div>
            
            <div>
              <label htmlFor="country" className="block text-sm font-medium text-gray-700 mb-1">
                Country
              </label>
              <input
                type="text"
                id="country"
                name="country"
                value={formData.country}
                readOnly
                className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50"
              />
            </div>
            
            <div className="pt-4">
              <button
                type="submit"
                disabled={isLoading}
                className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Saving Location...
                  </>
                ) : (
                  'Save Location'
                )}
              </button>
              
              <button
                type="button"
                onClick={handleClose}
                className="w-full mt-2 text-gray-600 py-2 rounded-lg font-medium hover:text-gray-800 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}