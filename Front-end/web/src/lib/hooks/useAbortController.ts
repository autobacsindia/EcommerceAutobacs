import { useEffect, useRef } from 'react';

interface UseAbortControllerResult {
  signal: AbortSignal;
  abort: (reason?: string) => void;
}

/**
 * Custom hook to manage AbortController lifecycle and provide better error handling
 * @returns Object containing signal and abort function
 */
export function useAbortController(): UseAbortControllerResult {
  const controllerRef = useRef<AbortController | null>(null);
  
  // Create controller on first render
  if (controllerRef.current === null) {
    controllerRef.current = new AbortController();
  }
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (controllerRef.current && controllerRef.current.signal.aborted === false) {
        controllerRef.current.abort(new DOMException('Component unmounted', 'AbortError'));
      }
      controllerRef.current = null;
    };
  }, []);
  
  const abort = (reason?: string) => {
    if (controllerRef.current && controllerRef.current.signal.aborted === false) {
      const abortReason = reason 
        ? new DOMException(reason, 'AbortError')
        : new DOMException('Request cancelled', 'AbortError');
      controllerRef.current.abort(abortReason);
    }
    // Create a new controller for subsequent requests
    controllerRef.current = new AbortController();
  };
  
  return {
    signal: controllerRef.current.signal,
    abort
  };
}