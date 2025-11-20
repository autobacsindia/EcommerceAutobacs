'use client';

import React, { useState, useEffect } from 'react';
import useIsMounted from '@/lib/hooks/useIsMounted';
import SkeletonLoader from './SkeletonLoader';

interface EnvironmentAwareComponentProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  skeletonType?: 'header' | 'search' | 'cart' | 'user' | 'mobile-menu';
  className?: string;
}

/**
 * Standardized component pattern for environment-aware components
 * Prevents hydration errors by rendering consistent loading states
 */
export default function EnvironmentAwareComponent({
  children,
  fallback = null,
  skeletonType = 'header',
  className = ''
}: EnvironmentAwareComponentProps) {
  const isMounted = useIsMounted();
  const [clientData, setClientData] = useState<any>(null);
  
  // Example of client-specific logic that runs only after mount
  useEffect(() => {
    if (isMounted) {
      // Client-specific logic here
      // For example, accessing window object, localStorage, etc.
      setClientData({
        // Example data that's only available on client
        viewportWidth: typeof window !== 'undefined' ? window.innerWidth : 0,
        prefersDarkMode: typeof window !== 'undefined' ? 
          window.matchMedia('(prefers-color-scheme: dark)').matches : false
      });
    }
  }, [isMounted]);
  
  // Render consistent loading state until mounted
  if (!isMounted) {
    return fallback || <SkeletonLoader type={skeletonType} className={className} />;
  }
  
  // Pass client data to children if needed
  return (
    <div className={className} data-client-data={JSON.stringify(clientData)}>
      {children}
    </div>
  );
}