'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

export default function AdminAnalyticsPage() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && (!isAuthenticated || user?.role !== 'admin')) {
      router.push('/login');
    }
  }, [isAuthenticated, user, isLoading, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated || user?.role !== 'admin') {
    return null;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Analytics</h1>
        <p className="text-gray-600 mt-1">Detailed business insights and reports</p>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4">Coming Soon</h2>
        <p className="text-gray-600">
          Advanced analytics features are under development. This section will include:
        </p>
        <ul className="mt-4 space-y-2 text-gray-600">
          <li className="flex items-center">
            <span className="mr-2">📊</span> Sales trends and forecasts
          </li>
          <li className="flex items-center">
            <span className="mr-2">👥</span> Customer behavior analysis
          </li>
          <li className="flex items-center">
            <span className="mr-2">🛍️</span> Product performance metrics
          </li>
          <li className="flex items-center">
            <span className="mr-2">📈</span> Revenue breakdown by category
          </li>
          <li className="flex items-center">
            <span className="mr-2">🗺️</span> Geographic sales distribution
          </li>
        </ul>
      </div>
    </div>
  );
}
