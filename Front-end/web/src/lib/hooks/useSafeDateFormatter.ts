import { useState, useEffect } from 'react';
import useIsMounted from './useIsMounted';

/**
 * Hook to safely format dates to prevent hydration errors
 * @param date The date to format
 * @param options Formatting options
 * @returns Formatted date string or placeholder
 */
export default function useSafeDateFormatter(
  date: Date | string | number | null | undefined,
  options?: Intl.DateTimeFormatOptions
) {
  const isMounted = useIsMounted();
  const [formattedDate, setFormattedDate] = useState('');
  
  useEffect(() => {
    if (isMounted && date) {
      try {
        const dateObj = date instanceof Date ? date : new Date(date);
        // Format date only on client to respect user locale
        setFormattedDate(dateObj.toLocaleString(undefined, options));
      } catch (error) {
        // Fallback to ISO string if formatting fails
        setFormattedDate(new Date().toISOString());
      }
    }
  }, [date, isMounted, options]);
  
  // Display raw date or consistent placeholder until mounted
  if (!isMounted) {
    return date ? '--/--/---- --:--' : 'N/A';
  }
  
  return formattedDate || 'N/A';
}