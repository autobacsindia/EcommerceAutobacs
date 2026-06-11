'use client';

import React, { useState, useRef, useEffect } from 'react';
import { DollarSign, IndianRupee, ChevronDown } from 'lucide-react';
import { useCurrency } from '@/context/CurrencyContext';

const CURRENCIES = [
  { code: 'INR' as const, name: 'Indian Rupee', symbol: '₹', icon: IndianRupee },
  { code: 'USD' as const, name: 'US Dollar', symbol: '$', icon: DollarSign },
];

export default function CurrencySwitcherDropdown() {
  const { currency, setCurrency } = useCurrency();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const currentCurrency = CURRENCIES.find(c => c.code === currency) || CURRENCIES[0];
  const CurrentIcon = currentCurrency.icon;

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleCurrencySelect = (currencyCode: 'INR' | 'USD') => {
    setCurrency(currencyCode);
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Dropdown Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-800 transition-colors text-white"
        aria-label="Select currency"
        aria-expanded={isOpen}
      >
        <CurrentIcon className="h-4 w-4" />
        <span className="text-sm font-medium">{currency}</span>
        <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${
          isOpen ? 'rotate-180' : ''
        }`} />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute top-full right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50 animate-fadeIn">
          {CURRENCIES.map((curr) => {
            const Icon = curr.icon;
            const isSelected = curr.code === currency;

            return (
              <button
                key={curr.code}
                onClick={() => handleCurrencySelect(curr.code)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors ${
                  isSelected ? 'bg-blue-50' : ''
                }`}
              >
                <Icon className={`h-5 w-5 ${
                  isSelected ? 'text-blue-600' : 'text-gray-600'
                }`} />
                <div className="flex-1 text-left">
                  <div className={`text-sm font-medium ${
                    isSelected ? 'text-blue-600' : 'text-gray-900'
                  }`}>
                    {curr.code}
                  </div>
                  <div className="text-xs text-gray-500">
                    {curr.name}
                  </div>
                </div>
                {isSelected && (
                  <div className="w-2 h-2 rounded-full bg-blue-600" />
                )}
              </button>
            );
          })}
        </div>
      )}

      <style jsx>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .animate-fadeIn {
          animation: fadeIn 200ms ease-out;
        }
      `}</style>
    </div>
  );
}