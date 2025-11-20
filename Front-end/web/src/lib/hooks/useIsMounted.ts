import { useState, useEffect } from 'react';

/**
 * Hook to safely detect if component is mounted to prevent hydration errors
 * @returns boolean indicating if component is mounted
 */
export default function useIsMounted() {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  return isMounted;
}