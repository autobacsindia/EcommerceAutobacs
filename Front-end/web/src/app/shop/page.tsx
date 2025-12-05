'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Shop Page - Redirects to Products
 * This maintains backward compatibility while using the new "Shop" navigation label
 */
export default function ShopPage() {
  const router = useRouter();

  useEffect(() => {
    // Redirect to products page
    router.replace('/products');
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-600">Redirecting to shop...</p>
      </div>
    </div>
  );
}
