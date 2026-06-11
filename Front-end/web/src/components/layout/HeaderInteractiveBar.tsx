'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ShoppingCart, Search, Heart, User, Menu } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useCart } from '@/context/CartContext';
import { useWishlist } from '@/context/WishlistContext';
import { Skeleton } from '@/components/ui/Skeleton';
import ClientSearchSuggestions from './ClientSearchSuggestions';
import CurrencySwitcherDropdown from './CurrencySwitcherDropdown';
import MobileMenu from './MobileMenu';
import EnvironmentAwareComponent from './EnvironmentAwareComponent';

export default function HeaderInteractiveBar() {
  const [showMobileSearch, setShowMobileSearch] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const { isAuthenticated, user, logout } = useAuth();
  const { itemCount } = useCart();
  const { wishlistCount } = useWishlist();

  return (
    <>
      <div className="flex items-center space-x-4 text-white flex-shrink-0 ml-auto">
        <div className="hidden sm:block">
          <CurrencySwitcherDropdown />
        </div>

        <button
          onClick={() => setShowMobileSearch(prev => !prev)}
          className="md:hidden p-2 text-white hover:text-[#3B9EE8] transition-colors"
          aria-label="Toggle search"
        >
          <Search className="h-5 w-5" />
        </button>

        <EnvironmentAwareComponent
          skeletonType="user"
          fallback={
            <div className="hidden md:flex items-center space-x-2">
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-8 w-20" />
            </div>
          }
        >
          <div className="hidden md:flex items-center space-x-2">
            {isAuthenticated ? (
              <>
                <Link
                  href="/profile"
                  className="flex items-center space-x-1 text-white hover:text-[#3B9EE8] transition-colors"
                >
                  <User className="h-5 w-5" />
                  <span className="hidden lg:inline text-sm">{user?.name}</span>
                </Link>
                <button
                  onClick={logout}
                  className="text-sm text-white hover:text-[#3B9EE8] transition-colors"
                >
                  Logout
                </button>
              </>
            ) : (
              <>
                <Link href="/login" className="text-sm text-white hover:text-[#3B9EE8] transition-colors">
                  Login
                </Link>
                <Link
                  href="/register"
                  className="text-sm bg-[#3B9EE8] text-white px-4 py-2 rounded-md hover:bg-[#1A6FB5] transition-colors font-medium font-condensed tracking-wider uppercase"
                >
                  Sign Up
                </Link>
              </>
            )}
          </div>
        </EnvironmentAwareComponent>

        <Link href="/wishlist" className="relative p-2 text-white hover:text-[#3B9EE8] transition-colors">
          <Heart className="h-5 w-5" />
          {wishlistCount > 0 && (
            <span className="absolute top-0 right-0 -mt-1 -mr-1 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
              {wishlistCount}
            </span>
          )}
        </Link>

        <Link href="/cart" className="relative p-2 text-white hover:text-[#3B9EE8] transition-colors" aria-label="Cart">
          <ShoppingCart className="h-5 w-5" />
          {itemCount > 0 && (
            <span className="absolute top-0 right-0 -mt-1 -mr-1 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
              {itemCount}
            </span>
          )}
        </Link>

        <button
          onClick={() => setShowMobileMenu(true)}
          className="md:hidden p-2 text-white hover:text-[#3B9EE8] transition-colors"
          aria-label="Open menu"
        >
          <Menu className="h-6 w-6" />
        </button>
      </div>

      {/* Fixed overlay — appears below the sticky header top row on mobile */}
      {showMobileSearch && (
        <div className="md:hidden fixed left-0 right-0 top-16 z-40 bg-black px-4 py-4 border-t border-gray-800">
          <ClientSearchSuggestions />
        </div>
      )}

      <MobileMenu isOpen={showMobileMenu} onClose={() => setShowMobileMenu(false)} />
    </>
  );
}
