'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

type Currency = 'INR' | 'USD';

/**
 * `exact` keeps the paise on a figure that has them.
 *
 * The default INR formatting rounds to whole rupees, which is right for a PRICE — the
 * catalogue does not sell anything at ₹999.47 — and wrong for a DISCOUNT, because
 * discounts are broken down. A campaign discount of 20,099 paise shown per line as two
 * ₹100.50 halves rounds to "₹101 + ₹101" against a "₹201" summary, and a shopper adding
 * up the bag finds a rupee that is not there. Worse, it rounds UP: an item charged
 * ₹29.97 off advertises "₹30 off", which is a promise the cart then breaks.
 *
 * So every figure that is part of a sum, or that a shopper can check against a charge,
 * asks for `exact`. Whole-rupee values are unaffected — the paise are only printed when
 * they exist, so "₹1,840" never becomes "₹1,840.00".
 */
export interface FormatPriceOptions {
  exact?: boolean;
}

interface CurrencyContextType {
  currency: Currency;
  setCurrency: (currency: Currency) => void;
  exchangeRate: number;
  formatPrice: (price: number, options?: FormatPriceOptions) => string;
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
  const formatPrice = (price: number, options?: FormatPriceOptions): string => {
    if (currency === 'INR') {
      // Paise are printed only when the value actually has them, so an exact-formatted
      // whole-rupee figure is indistinguishable from an ordinary one.
      const hasPaise = Math.round(price * 100) % 100 !== 0;
      const digits = options?.exact && hasPaise ? 2 : 0;
      return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
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
