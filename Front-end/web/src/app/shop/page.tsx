'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function ShopPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/products');
  }, [router]);

  return (
    <div className="min-h-screen bg-obsidian-deep flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gold mx-auto mb-4"></div>
        <p className="text-ink/70 font-display">Redirecting to shop...</p>
      </div>
    </div>
  );
}
