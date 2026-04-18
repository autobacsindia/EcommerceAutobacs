'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { X, Home, ShoppingBag, Tag, Car, Heart, Gift, User, LogOut } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { NAV_LINKS } from '@/lib/constants';
import { usePathname } from 'next/navigation';
import HeaderVehicleSelector from './HeaderVehicleSelector';

interface MobileMenuProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function MobileMenu({ isOpen, onClose }: MobileMenuProps) {
  const { isAuthenticated, user, logout } = useAuth();
  const pathname = usePathname();

  // Prevent body scroll when menu is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Close on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const getIconForLink = (href: string) => {
    switch (href) {
      case '/':
        return <Home className="h-5 w-5" />;
      case '/shop':
        return <ShoppingBag className="h-5 w-5" />;
      case '/brands':
        return <Tag className="h-5 w-5" />;
      case '/vehicles':
        return <Car className="h-5 w-5" />;
      case '/wishlist':
        return <Heart className="h-5 w-5" />;
      case '/offers':
        return <Gift className="h-5 w-5" />;
      case '/categories/accessories':
      case '/categories/exterior':
      case '/categories/interior':
      case '/categories/bodykit':
      case '/categories/performance':
      case '/categories/suspension':
      case '/categories/audio':
      case '/categories/lights':
        return <ShoppingBag className="h-5 w-5" />;
      default:
        return <ShoppingBag className="h-5 w-5" />;
    }
  };

  const handleLinkClick = () => {
    onClose();
  };

  const handleLogout = () => {
    logout();
    onClose();
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 z-40 animate-fadeIn"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-out Menu */}
      <div
        className="fixed top-0 right-0 h-full w-80 max-w-[85vw] bg-white shadow-2xl z-50 animate-slideInRight"
        role="dialog"
        aria-modal="true"
        aria-label="Mobile navigation menu"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Menu</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
            aria-label="Close menu"
          >
            <X className="h-6 w-6 text-gray-600" />
          </button>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 overflow-y-auto">
          <ul className="py-2">
            {/* Home Link */}
            <li>
              <Link
                href="/"
                onClick={handleLinkClick}
                className={`flex items-center gap-3 px-4 py-3 text-gray-700 hover:bg-gray-100 transition-colors ${
                  pathname === '/' ? 'bg-blue-50 text-blue-600 font-medium' : ''
                }`}
              >
                <Home className="h-5 w-5" />
                <span>Home</span>
              </Link>
            </li>

            {/* Main Navigation Links */}
            
            {/* Shop */}
            <li>
              <Link
                href="/shop"
                onClick={handleLinkClick}
                className={`flex items-center gap-3 px-4 py-3 text-gray-700 hover:bg-gray-100 transition-colors ${
                  pathname === '/shop' ? 'bg-blue-50 text-blue-600 font-medium' : ''
                }`}
              >
                <ShoppingBag className="h-5 w-5" />
                <span>Shop</span>
              </Link>
            </li>

            {/* Brand */}
            <li>
              <Link
                href="/brands"
                onClick={handleLinkClick}
                className={`flex items-center gap-3 px-4 py-3 text-gray-700 hover:bg-gray-100 transition-colors ${
                  pathname === '/brands' || pathname.startsWith('/brands') ? 'bg-blue-50 text-blue-600 font-medium' : ''
                }`}
              >
                <Tag className="h-5 w-5" />
                <span>Brand</span>
              </Link>
            </li>

            {/* Vehicle Selector */}
            <li className="px-4 py-3 border-t border-b border-gray-200 my-2">
              <div className="text-sm font-medium text-gray-700 mb-2">Select Your Vehicle</div>
              <HeaderVehicleSelector />
            </li>

            {/* Render remaining nav links from NAV_LINKS (Accessories, Exterior, etc.) */}
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  onClick={handleLinkClick}
                  className={`flex items-center gap-3 px-4 py-3 text-gray-700 hover:bg-gray-100 transition-colors ${
                    pathname === link.href ? 'bg-blue-50 text-blue-600 font-medium' : ''
                  }`}
                >
                  {getIconForLink(link.href)}
                  <span>{link.label}</span>
                </Link>
              </li>
            ))}
          </ul>

          {/* Divider */}
          <div className="border-t border-gray-200 my-2" />

          {/* User Section */}
          <div className="py-2">
            {isAuthenticated ? (
              <>
                <Link
                  href="/profile"
                  onClick={handleLinkClick}
                  className={`flex items-center gap-3 px-4 py-3 text-gray-700 hover:bg-gray-100 transition-colors ${
                    pathname === '/profile' ? 'bg-blue-50 text-blue-600 font-medium' : ''
                  }`}
                >
                  <User className="h-5 w-5" />
                  <div className="flex flex-col">
                    <span className="font-medium">{user?.name}</span>
                    <span className="text-xs text-gray-500">{user?.email}</span>
                  </div>
                </Link>
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-3 px-4 py-3 text-red-600 hover:bg-red-50 transition-colors w-full"
                >
                  <LogOut className="h-5 w-5" />
                  <span>Logout</span>
                </button>
              </>
            ) : (
              <>
                <Link
                  href="/login"
                  onClick={handleLinkClick}
                  className="flex items-center gap-3 px-4 py-3 text-gray-700 hover:bg-gray-100 transition-colors"
                >
                  <User className="h-5 w-5" />
                  <span>Login</span>
                </Link>
                <Link
                  href="/register"
                  onClick={handleLinkClick}
                  className="mx-4 mt-2 flex items-center justify-center gap-2 bg-blue-600 text-white px-4 py-3 rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <span>Sign Up</span>
                </Link>
              </>
            )}
          </div>
        </nav>
      </div>

      <style jsx>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }

        @keyframes slideInRight {
          from {
            transform: translateX(100%);
          }
          to {
            transform: translateX(0);
          }
        }

        .animate-fadeIn {
          animation: fadeIn 200ms ease-in-out;
        }

        .animate-slideInRight {
          animation: slideInRight 300ms ease-in-out;
        }
      `}</style>
    </>
  );
}
