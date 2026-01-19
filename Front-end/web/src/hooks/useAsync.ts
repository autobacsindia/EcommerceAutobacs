import { useState, useCallback } from 'react';
import { useErrorHandler } from './useErrorHandler';

interface AsyncState<T> {
  status: 'idle' | 'pending' | 'success' | 'error';
  value: T | null;
  error: any | null;
}

export const useAsync = <T, = any>(asyncFunction?: () => Promise<T>, immediate = true) => {
  const [state, setState] = useState<AsyncState<T>>({
    status: 'idle',
    value: null,
    error: null,
  });

  const { handleError } = useErrorHandler();

  const execute = useCallback(
    async (promiseOrFunction?: Promise<T> | (() => Promise<T>)) => {
      setState({ status: 'pending', value: null, error: null });

      try {
        const promise = typeof promiseOrFunction === 'function' 
          ? promiseOrFunction() 
          : promiseOrFunction || (asyncFunction ? asyncFunction() : null);

        if (!promise) {
          throw new Error('No async function or promise provided to useAsync');
        }

        const response = await promise;
        setState({ status: 'success', value: response, error: null });
        return response;
      } catch (error) {
        handleError(error);
        setState({ status: 'error', value: null, error });
        throw error;
      }
    },
    [asyncFunction, handleError]
  );

  // If immediate is true and asyncFunction is provided, we could execute it.
  // However, useAsync usually doesn't auto-execute in strict mode unless inside useEffect.
  // For simplicity, we leave auto-execution to the consumer via useEffect.

  return { execute, ...state };
};
