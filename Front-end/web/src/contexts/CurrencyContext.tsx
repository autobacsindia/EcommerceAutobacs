'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

type Currency = 'INR' | 'USD';

interface CurrencyContextType {
  currency: Currency;
  setCurrency: (currency: Currency) => void;
  exchangeRate: number;
  formatPrice: (price: number) => string;
}

const CurrencyContext = createContext<CurrencyContextType | undefined>(undefined);

// Exchange rate: 1 USD = 83 INR (approximate, can be made dynamic)
const USD_TO_INR_RATE = 83;

interface CurrencyProviderProps {
  children: ReactNode;
}

export function CurrencyProvider({ children }: CurrencyProviderProps) {
  const [currency, setCurrencyState] = useState<Currency>('INR');
  const [exchangeRate] = useState<number>(USD_TO_INR_RATE);

  // Load currency preference from localStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedCurrency = localStorage.getItem('preferred_currency') as Currency;
      if (savedCurrency === 'INR' || savedCurrency === 'USD') {
        setCurrencyState(savedCurrency);
      }
    }
  }, []);

  // Save currency preference to localStorage when it changes
  const setCurrency = (newCurrency: Currency) => {
    setCurrencyState(newCurrency);
    if (typeof window !== 'undefined') {
      localStorage.setItem('preferred_currency', newCurrency);
    }
  };

  // Format price based on current currency
  const formatPrice = (price: number): string => {
    if (currency === 'INR') {
      return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0,
        minimumFractionDigits: 0,
      }).format(price);
    } else {
      // Convert INR to USD
      const priceInUSD = price / exchangeRate;
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 2,
        minimumFractionDigits: 2,
      }).format(priceInUSD);
    }
  };

  return (
    <CurrencyContext.Provider value={{ currency, setCurrency, exchangeRate, formatPrice }}>
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency() {
  const context = useContext(CurrencyContext);
  if (context === undefined) {
    throw new Error('useCurrency must be used within a CurrencyProvider');
  }
  return context;
}
