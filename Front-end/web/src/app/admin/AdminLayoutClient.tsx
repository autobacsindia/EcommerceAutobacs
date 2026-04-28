'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';

interface AdminLayoutClientProps {
  children: React.ReactNode;
  userId: string;
}

interface NavItem {
  href?: string;
  label: string;
  icon: string;
  children?: NavItem[];
}

export default function AdminLayoutClient({ children, userId }: AdminLayoutClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    'Catalog': true,
    'Orders': false,
    'Customers': false,
    'Content': false,
    'Finance': false,
    'System': false,
  });
  const [stats, setStats] = useState({
    totalOrders: 0,
    pendingOrders: 0,
    totalRevenue: 0,
  });

  // Admin navigation links with sub-menus
  const navSections: { title: string; items: NavItem[] }[] = [
    {
      title: 'Main',
      items: [
        { href: '/admin', label: 'Dashboard', icon: '📊' },
        { href: '/admin/analytics', label: 'Analytics', icon: '📈' },
      ]
    },
    {
      title: 'Catalog',
      items: [
        { href: '/admin/products', label: 'Products', icon: '🛍️' },
        { href: '/admin/brands', label: 'Brands', icon: '🏷️' },
        { href: '/admin/categories', label: 'Categories', icon: '📂' },
        { href: '/admin/vehicles', label: 'Vehicles', icon: '🚗' },
      ]
    },
    {
      title: 'Orders',
      items: [
        { href: '/admin/orders', label: 'Orders', icon: '📦' },
        { href: '/admin/returns', label: 'Returns', icon: '↩️' },
        { href: '/admin/refunds', label: 'Refunds', icon: '💰' },
      ]
    },
    {
      title: 'Customers',
      items: [
        { href: '/admin/users', label: 'Users', icon: '👥' },
        { href: '/admin/reviews', label: 'Reviews', icon: '⭐' },
        { href: '/admin/questions', label: 'Q&A', icon: '❓' },
      ]
    },
    {
      title: 'Content',
      items: [
        { href: '/admin/media', label: 'Media', icon: '🖼️' },
        { href: '/admin/messages', label: 'Messages', icon: '💬' },
        { href: '/admin/consultation', label: 'Consultations', icon: '🎯' },
      ]
    },
    {
      title: 'System',
      items: [
        { href: '/admin/workflows', label: 'Workflows', icon: '⚡' },
        { href: '/admin/settings', label: 'Settings', icon: '⚙️' },
      ]
    },
  ];

  const toggleSection = (title: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [title]: !prev[title]
    }));
  };

  const isLinkActive = (href?: string) => {
    if (!href) return false;
    return pathname === href || pathname.startsWith(href + '/');
  };

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
        <nav className="flex-1 p-4 space-y-2 overflow-y-auto max-h-[calc(100vh-200px)]">
          {navSections.map((section) => {
            const isSectionActive = section.items.some(item => isLinkActive(item.href));
            const isExpanded = expandedSections[section.title];

            return (
              <div key={section.title} className="mb-2">
                {/* Section Header */}
                {sidebarOpen && (
                  <button
                    onClick={() => toggleSection(section.title)}
                    className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider hover:text-gray-300 transition-colors"
                  >
                    <span>{section.title}</span>
                    <span className={`transform transition-transform ${isExpanded ? 'rotate-90' : ''}`}>
                      ▶
                    </span>
                  </button>
                )}

                {/* Section Items */}
                {(isExpanded || !sidebarOpen) && (
                  <div className="space-y-1 mt-1">
                    {section.items.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href!}
                        className={`flex items-center p-3 rounded-lg transition-all ${
                          isLinkActive(item.href)
                            ? 'bg-blue-600 text-white shadow-lg'
                            : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                        } ${!sidebarOpen ? 'justify-center' : ''}`}
                      >
                        <span className="text-xl flex-shrink-0">{item.icon}</span>
                        {sidebarOpen && (
                          <span className="ml-3 text-sm font-medium">{item.label}</span>
                        )}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
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
          <div className="flex items-center gap-4">
            <h2 className="text-2xl font-bold text-gray-800">
              {navSections.flatMap(s => s.items).find((link) => link.href === pathname)?.label || 'Admin'}
            </h2>
            <Link
              href="/"
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium"
            >
              <span>🌐</span>
              <span>View Site</span>
            </Link>
          </div>

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
