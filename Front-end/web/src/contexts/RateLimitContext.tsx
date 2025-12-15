'use client';

import React, { createContext, useContext, useState, ReactNode } from 'react';
import RateLimitNotification from '../components/layout/RateLimitNotification';

interface RateLimitContextType {
  showRateLimitNotification: (retryAfter: number) => void;
  hideRateLimitNotification: () => void;
}

const RateLimitContext = createContext<RateLimitContextType | undefined>(undefined);

export const RateLimitProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [showNotification, setShowNotification] = useState(false);
  const [retryAfter, setRetryAfter] = useState(0);

  const showRateLimitNotification = (retryAfterSeconds: number) => {
    setRetryAfter(retryAfterSeconds);
    setShowNotification(true);
  };

  const hideRateLimitNotification = () => {
    setShowNotification(false);
    setRetryAfter(0);
  };

  return (
    <RateLimitContext.Provider value={{ showRateLimitNotification, hideRateLimitNotification }}>
      {children}
      {showNotification && (
        <RateLimitNotification 
          retryAfter={retryAfter} 
          onDismiss={hideRateLimitNotification} 
        />
      )}
    </RateLimitContext.Provider>
  );
};

export const useRateLimit = () => {
  const context = useContext(RateLimitContext);
  if (context === undefined) {
    throw new Error('useRateLimit must be used within a RateLimitProvider');
  }
  return context;
};