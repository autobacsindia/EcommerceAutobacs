'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShoppingCart, User, Menu, Search } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useCart } from '@/context/CartContext';
import { APP_NAME, NAV_LINKS } from '@/lib/constants';
import SearchSuggestions from './SearchSuggestions';

export default function Header() {
  const { isAuthenticated, user, logout } = useAuth();
  const { itemCount } = useCart();
  const router = useRouter();
  const [showMobileSearch, setShowMobileSearch] = useState(false);

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <div className="flex-shrink-0">
            <Link href="/" className="text-2xl font-bold text-blue-600">
              {APP_NAME}
            </Link>
          </div>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex space-x-8">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-gray-700 hover:text-blue-600 px-3 py-2 text-sm font-medium transition-colors"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          {/* Right Section */}
          <div className="flex items-center space-x-4">
            {/* Desktop Search */}
            <div className="hidden md:block w-64">
              <SearchSuggestions />
            </div>

            {/* Mobile Search Icon */}
            <button 
              onClick={() => setShowMobileSearch(!showMobileSearch)}
              className="md:hidden p-2 text-gray-600 hover:text-blue-600"
            >
              <Search className="h-5 w-5" />
            </button>

            {/* Cart */}
            <Link href="/cart" className="relative p-2 text-gray-600 hover:text-blue-600">
              <ShoppingCart className="h-5 w-5" />
              {itemCount > 0 && (
                <span className="absolute top-0 right-0 -mt-1 -mr-1 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
                  {itemCount}
                </span>
              )}
            </Link>

            {/* User Menu */}
            <div className="relative">
              {isAuthenticated ? (
                <div className="flex items-center space-x-2">
                  <Link
                    href="/profile"
                    className="flex items-center space-x-1 text-gray-700 hover:text-blue-600"
                  >
                    <User className="h-5 w-5" />
                    <span className="hidden sm:inline text-sm">{user?.name}</span>
                  </Link>
                  <button
                    onClick={logout}
                    className="text-sm text-gray-600 hover:text-red-600 ml-2"
                  >
                    Logout
                  </button>
                </div>
              ) : (
                <div className="flex items-center space-x-2">
                  <Link
                    href="/login"
                    className="text-sm text-gray-700 hover:text-blue-600"
                  >
                    Login
                  </Link>
                  <Link
                    href="/register"
                    className="text-sm bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700"
                  >
                    Sign Up
                  </Link>
                </div>
              )}
            </div>

            {/* Mobile Menu Button */}
            <button className="md:hidden p-2 text-gray-600">
              <Menu className="h-6 w-6" />
            </button>
          </div>
        </div>

        {/* Mobile Search Bar */}
        {showMobileSearch && (
          <div className="md:hidden py-4">
            <SearchSuggestions />
          </div>
        )}
      </div>
    </header>
  );
}