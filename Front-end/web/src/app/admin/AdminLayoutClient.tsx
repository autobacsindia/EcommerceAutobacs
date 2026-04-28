'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';

interface AdminLayoutClientProps {
  children: React.ReactNode;
  userId: string;
}

export default function AdminLayoutClient({ children, userId }: AdminLayoutClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [stats, setStats] = useState({
    totalOrders: 0,
    pendingOrders: 0,
    totalRevenue: 0,
  });

  // Admin navigation links
  const navLinks = [
    { href: '/admin', label: 'Dashboard', icon: '📊' },
    { href: '/admin/orders', label: 'Orders', icon: '📦' },
    { href: '/admin/products', label: 'Products', icon: '🛍️' },
    { href: '/admin/brands', label: 'Brands', icon: '🏷️' },
    { href: '/admin/categories', label: 'Categories', icon: '📂' },
    { href: '/admin/vehicles', label: 'Vehicles', icon: '🚗' },
    { href: '/admin/reviews', label: 'Reviews', icon: '⭐' },
    { href: '/admin/users', label: 'Users', icon: '👥' },
    { href: '/admin/messages', label: 'Messages', icon: '💬' },
    { href: '/admin/media', label: 'Media', icon: '🖼️' },
    { href: '/admin/consultation', label: 'Consultations', icon: '🎯' },
    { href: '/admin/questions', label: 'Q&A', icon: '❓' },
    { href: '/admin/refunds', label: 'Refunds', icon: '💰' },
    { href: '/admin/returns', label: 'Returns', icon: '↩️' },
    { href: '/admin/workflows', label: 'Workflows', icon: '⚡' },
    { href: '/admin/analytics', label: 'Analytics', icon: '📈' },
    { href: '/admin/settings', label: 'Settings', icon: '⚙️' },
  ];

  // Fetch admin stats (polling every 30 seconds)
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const response = await fetch('/api/v1/admin/stats', {
          credentials: 'include',
        });
        
        if (response.ok) {
          const data = await response.json();
          setStats(data.stats || stats);
        }
      } catch (error) {
        console.error('[Admin] Failed to fetch stats:', error);
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 30000); // 30 seconds

    return () => clearInterval(interval);
  }, []);

  const handleLogout = async () => {
    try {
      await fetch('/api/v1/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
      router.push('/login');
    } catch (error) {
      console.error('[Admin] Logout failed:', error);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <aside
        className={`${
          sidebarOpen ? 'w-64' : 'w-20'
        } bg-gray-900 text-white transition-all duration-300 flex flex-col fixed h-full z-10`}
      >
        {/* Logo */}
        <div className="p-4 border-b border-gray-800">
          <h1 className={`font-bold text-xl ${!sidebarOpen && 'hidden'}`}>
            Autobacs Admin
          </h1>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="mt-2 text-gray-400 hover:text-white"
          >
            {sidebarOpen ? '◀' : '▶'}
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-2">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`flex items-center p-3 rounded-lg transition-colors ${
                pathname === link.href
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-300 hover:bg-gray-800'
              }`}
            >
              <span className="text-xl">{link.icon}</span>
              {sidebarOpen && <span className="ml-3">{link.label}</span>}
            </Link>
          ))}
        </nav>

        {/* User Info */}
        <div className="p-4 border-t border-gray-800">
          {sidebarOpen && (
            <div className="mb-3">
              <p className="text-sm text-gray-400">Logged in as:</p>
              <p className="text-sm font-medium truncate">{userId}</p>
            </div>
          )}
          <button
            onClick={handleLogout}
            className="w-full p-2 bg-red-600 hover:bg-red-700 rounded-lg text-sm transition-colors"
          >
            {sidebarOpen ? 'Logout' : '🚪'}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main
        className={`flex-1 ${
          sidebarOpen ? 'ml-64' : 'ml-20'
        } transition-all duration-300`}
      >
        {/* Top Bar */}
        <header className="bg-white shadow-sm border-b px-6 py-4 flex justify-between items-center sticky top-0 z-10">
          <h2 className="text-2xl font-bold text-gray-800">
            {navLinks.find((link) => link.href === pathname)?.label || 'Admin'}
          </h2>

          {/* Stats Overview */}
          <div className="flex items-center space-x-6">
            <div className="text-right">
              <p className="text-sm text-gray-500">Pending Orders</p>
              <p className="text-lg font-bold text-orange-600">
                {stats.pendingOrders}
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm text-gray-500">Total Revenue</p>
              <p className="text-lg font-bold text-green-600">
                ₹{stats.totalRevenue.toLocaleString()}
              </p>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}
