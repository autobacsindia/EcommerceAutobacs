/**
 * Route-Aware Error Boundary
 * 
 * Automatically resets error state when route changes
 * 
 * Usage:
 *   <RouteAwareErrorBoundary feature="checkout">
 *     <CheckoutPage />
 *   </RouteAwareErrorBoundary>
 */

'use client';

import { usePathname } from 'next/navigation';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  feature?: string;
  onError?: (error: Error, errorInfo: any) => void;
  onReset?: () => void;
}

/**
 * Route-aware error boundary that auto-resets on navigation
 * 
 * Without this:
 * - User sees error on /products
 * - Navigates to /cart
 * - Still sees error screen ❌
 * 
 * With this:
 * - User sees error on /products
 * - Navigates to /cart
 * - Cart loads normally ✅
 */
export function RouteAwareErrorBoundary({ 
  children, 
  fallback, 
  feature, 
  onError,
  onReset 
}: Props) {
  const pathname = usePathname();
  
  return (
    <ErrorBoundary
      key={pathname} // ← Key change forces reset on route change
      fallback={fallback}
      feature={feature}
      onError={onError}
      onReset={onReset}
      resetKeys={[pathname]}
    >
      {children}
    </ErrorBoundary>
  );
}

export default RouteAwareErrorBoundary;
