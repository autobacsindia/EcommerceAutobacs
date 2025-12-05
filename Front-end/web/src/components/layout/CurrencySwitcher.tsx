'use client';

import React from 'react';
import { DollarSign, IndianRupee } from 'lucide-react';
import { useCurrency } from '@/contexts/CurrencyContext';

export default function CurrencySwitcher() {
  const { currency, setCurrency } = useCurrency();

  const toggleCurrency = () => {
    setCurrency(currency === 'INR' ? 'USD' : 'INR');
  };

  return (
    <button
      onClick={toggleCurrency}
      className="flex items-center gap-1 px-3 py-2 rounded-lg hover:bg-gray-800 transition-colors group relative"
      aria-label={`Switch to ${currency === 'INR' ? 'USD' : 'INR'}`}
      title={`Switch to ${currency === 'INR' ? 'USD' : 'INR'}`}
    >
      {/* Currency Icons */}
      <div className="flex items-center gap-1">
        {/* INR Icon */}
        <div
          className={`transition-all duration-200 ${
            currency === 'INR'
              ? 'text-white scale-110'
              : 'text-green-300 scale-90 opacity-50'
          }`}
        >
          <IndianRupee className="h-5 w-5" />
        </div>

        {/* Divider */}
        <div className="h-4 w-px bg-green-400" />

        {/* USD Icon */}
        <div
          className={`transition-all duration-200 ${
            currency === 'USD'
              ? 'text-white scale-110'
              : 'text-green-300 scale-90 opacity-50'
          }`}
        >
          <DollarSign className="h-5 w-5" />
        </div>
      </div>

      {/* Tooltip on hover - hidden on mobile */}
      <span className="absolute -bottom-8 left-1/2 transform -translate-x-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap hidden sm:block z-50">
        Switch to {currency === 'INR' ? 'USD' : 'INR'}
      </span>
    </button>
  );
}
