'use client';

import React from 'react';
import useSafeDateFormatter from '@/lib/hooks/useSafeDateFormatter';

interface DateTimeDisplayProps {
  timestamp: Date | string | number | null | undefined;
  options?: Intl.DateTimeFormatOptions;
  className?: string;
  prefix?: string;
}

/**
 * Standardized component for displaying dates and times safely
 * Prevents hydration errors by formatting dates only on the client
 */
export default function DateTimeDisplay({
  timestamp,
  options,
  className = '',
  prefix = ''
}: DateTimeDisplayProps) {
  const formattedDate = useSafeDateFormatter(timestamp, options);
  
  return (
    <span className={className}>
      {prefix}{formattedDate}
    </span>
  );
}