'use client';

import { ReactNode, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import apiClient from '@/lib/api';
import { 
  LayoutDashboard, 
  Package, 
  FolderOpen, 
  Tag, 
  Car,
  ShoppingCart, 
  Users, 
  RotateCcw,
  DollarSign,
  GitBranch,
  MessageCircle,
  HelpCircle,
  Mail,
  Home,
  LogOut,
  User
} from 'lucide-react';

export default function AdminLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { isAuthenticated, isLoading, user, logout } = useAuth();
  const [messageCount, setMessageCount] = useState(0);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
    }
    // In production, check if user.role === 'admin'
  }, [isAuthenticated, isLoading, router]);

  useEffect(() => {
    if (isAuthenticated) {
      const fetchStats = async () => {
        try {
          const res = await apiClient.get<{ success: boolean; data: { newCount: number } }>('/contact/stats');
          if (res.success) {
            setMessageCount(res.data.newCount);
          }
        } catch (error) {
          console.error('Failed to fetch stats:', error);
        }
      };

      fetchStats();
      
      // Optional: Poll every 30 seconds
      const interval = setInterval(fetchStats, 30000);
      return () => clearInterval(interval);
    }
  }, [isAuthenticated]);

  if (isLoading) {
    return <div className="text-center py-8">Loading...</div>;
  }

  if (!isAuthenticated) {
    return null;
  }

  const menuItems = [
    { icon: LayoutDashboard, label: 'Dashboard', href: '/admin/dashboard' },
    { icon: FolderOpen, label: 'Categories', href: '/admin/categories' },
    { icon: Tag, label: 'Brands', href: '/admin/brands' },
    { icon: Car, label: 'Vehicles', href: '/admin/vehicles' },
    { icon: Package, label: 'Products', href: '/admin/products' },
    { icon: ShoppingCart, label: 'Orders', href: '/admin/orders' },
    { icon: RotateCcw, label: 'Returns', href: '/admin/returns' },
    { icon: DollarSign, label: 'Refunds', href: '/admin/refunds' },
    { icon: GitBranch, label: 'Workflows', href: '/admin/workflows' },
    { icon: MessageCircle, label: 'Reviews', href: '/admin/reviews' },
    { icon: HelpCircle, label: 'Questions', href: '/admin/questions' },
    { icon: Mail, label: 'Messages', href: '/admin/messages' },
    { icon: Users, label: 'Users', href: '/admin/users' },
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* Sidebar */}
      <aside className="w-64 bg-gray-900 text-white flex flex-col">
        <div className="p-6 flex-1 overflow-y-auto">
          <h2 className="text-2xl font-bold mb-8">Admin Panel</h2>
          <nav className="space-y-2">
            {menuItems.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-center justify-between px-4 py-3 rounded-lg hover:bg-gray-800 transition"
                >
                  <div className="flex items-center gap-3">
                    <Icon className="h-5 w-5" />
                    {item.label}
                  </div>
                  {item.href === '/admin/messages' && messageCount > 0 && (
                    <span className="bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                      {messageCount}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Admin Header */}
        <header className="bg-white shadow-sm h-16 flex items-center justify-between px-6 flex-none z-10">
          <div className="font-semibold text-gray-700">
            {/* You could add dynamic breadcrumbs here */}
          </div>
          <div className="flex items-center space-x-4">
            <Link href="/" className="text-gray-500 hover:text-gray-900 flex items-center text-sm font-medium transition-colors">
              <Home className="h-4 w-4 mr-1.5" />
              View Website
            </Link>
            <div className="h-6 w-px bg-gray-300 mx-2"></div>
            <div className="flex items-center space-x-3">
              <div className="flex items-center text-sm text-gray-700 font-medium">
                <div className="h-8 w-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center mr-2">
                  <User className="h-4 w-4" />
                </div>
                <span>{user?.name || 'Admin'}</span>
              </div>
              <button 
                onClick={logout}
                className="p-2 text-gray-400 hover:text-red-600 transition-colors rounded-full hover:bg-red-50"
                title="Logout"
              >
                <LogOut className="h-5 w-5" />
              </button>
            </div>
          </div>
        </header>

        {/* Page Content Container */}
        <div className="flex-1 overflow-auto">
          {children}
        </div>
      </main>
    </div>
  );
}