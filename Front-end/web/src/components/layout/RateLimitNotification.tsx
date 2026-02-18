'use client';

import React, { useState, useEffect } from 'react';

interface RateLimitNotificationProps {
  retryAfter: number; // in seconds
  onDismiss?: () => void;
}

const RateLimitNotification: React.FC<RateLimitNotificationProps> = ({ 
  retryAfter, 
  onDismiss 
}) => {
  const [timeLeft, setTimeLeft] = useState(retryAfter);

  useEffect(() => {
    if (timeLeft <= 0) {
      if (onDismiss) onDismiss();
      return;
    }

    const timer = setInterval(() => {
      setTimeLeft(prev => {
        const newTime = prev - 1;
        if (newTime <= 0) {
          return 0;
        }
        return newTime;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [timeLeft, onDismiss]);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  return (
    <div className="fixed top-4 right-4 z-50 bg-orange-100 border-l-4 border-orange-500 text-orange-700 p-4 rounded shadow-lg max-w-md">
      <div className="flex justify-between items-start">
        <div>
          <p className="font-bold">Rate Limit Exceeded</p>
          <p className="text-sm mt-1">
            Too many requests. Please wait {formatTime(timeLeft)} before trying again.
          </p>
        </div>
        <button 
          onClick={onDismiss}
          className="text-orange-700 hover:text-orange-900 font-bold ml-4"
          aria-label="Dismiss notification"
        >
          ×
        </button>
      </div>
      <div className="mt-2 w-full bg-orange-200 rounded-full h-2">
        <div 
          role="progressbar"
          aria-valuenow={((retryAfter - timeLeft) / retryAfter) * 100}
          aria-valuemin={0}
          aria-valuemax={100}
          className="bg-orange-500 h-2 rounded-full transition-all duration-1000 ease-linear" 
          style={{ width: `${((retryAfter - timeLeft) / retryAfter) * 100}%` }}
        ></div>
      </div>
    </div>
  );
};

export default RateLimitNotification;