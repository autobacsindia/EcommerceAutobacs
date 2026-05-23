'use client';

import Link from 'next/link';
import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { ShoppingCart, User, Menu, Search, Heart } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useCart } from '@/context/CartContext';
import { useWishlist } from '@/context/WishlistContext';
import { NAV_LINKS } from '@/lib/constants';
import ClientSearchSuggestions from './ClientSearchSuggestions';
import SkeletonLoader from './SkeletonLoader';
import { Skeleton } from '@/components/ui/Skeleton';
import EnvironmentAwareComponent from './EnvironmentAwareComponent';
import LocationDisplay from '@/components/location/LocationDisplay';
import BrandLogo from './BrandLogo';
import CurrencySwitcherDropdown from './CurrencySwitcherDropdown';
import MobileMenu from './MobileMenu';
import HeaderVehicleSelector from './HeaderVehicleSelector';

export default function Header() {
  const { isAuthenticated, user, logout, isLoading: authLoading } = useAuth();
  const { itemCount } = useCart();
  const { wishlistCount } = useWishlist();
  const pathname = usePathname();
  const [showMobileSearch, setShowMobileSearch] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);

  // Show skeleton while loading auth state
  if (authLoading) {
    return <SkeletonLoader type="header" />;
  }

  return (
    <header className="bg-black sticky top-0 z-50 shadow-md w-full">
      <div className="w-full px-4 sm:px-6 lg:px-8">
        {/* Top Row - Primary Actions Bar */}
        <div className="flex items-center h-16 border-b border-gray-800 gap-4">
          {/* Logo */}
          <div className="flex-shrink-0">
            <BrandLogo variant="full" />
          </div>

          {/* Location Display - Shows user's delivery location */}
          <div className="hidden lg:block flex-shrink-0">
            <LocationDisplay compact={true} />
          </div>

          {/* Search Bar - Desktop */}
          <div className="hidden md:block flex-1 max-w-4xl">
            <ClientSearchSuggestions />
          </div>

          {/* Right Section */}
          <div className="flex items-center space-x-4 text-white flex-shrink-0 ml-auto">
            {/* Currency Switcher */}
            <div className="hidden sm:block">
              <CurrencySwitcherDropdown />
            </div>

            {/* Mobile Search Icon */}
            <button 
              onClick={() => setShowMobileSearch(!showMobileSearch)}
              className="md:hidden p-2 text-white hover:text-[#3B9EE8] transition-colors"
              aria-label="Toggle search"
            >
              <Search className="h-5 w-5" />
            </button>

            {/* User Menu - Desktop */}
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
                    <Link
                      href="/login"
                      className="text-sm text-white hover:text-[#3B9EE8] transition-colors"
                    >
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

            {/* Wishlist */}
            <Link href="/wishlist" className="relative p-2 text-white hover:text-[#3B9EE8] transition-colors">
              <Heart className="h-5 w-5" />
              {wishlistCount > 0 && (
                <span className="absolute top-0 right-0 -mt-1 -mr-1 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
                  {wishlistCount}
                </span>
              )}
            </Link>

            {/* Cart */}
            <Link href="/cart" className="relative p-2 text-white hover:text-[#3B9EE8] transition-colors" aria-label="Cart">
              <ShoppingCart className="h-5 w-5" />
              {itemCount > 0 && (
                <span className="absolute top-0 right-0 -mt-1 -mr-1 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
                  {itemCount}
                </span>
              )}
            </Link>

            {/* Mobile Menu Button */}
            <button 
              onClick={() => setShowMobileMenu(true)}
              className="md:hidden p-2 text-white hover:text-[#3B9EE8] transition-colors"
              aria-label="Open menu"
            >
              <Menu className="h-6 w-6" />
            </button>
          </div>
        </div>

        {/* Bottom Row - Navigation Menu */}
        <nav className="hidden md:flex items-center justify-between gap-2 w-full h-10" data-version="v4">
          {/* Shop Link */}
          <Link
            key="/shop"
            href="/shop"
            className={`text-sm font-medium transition-colors relative py-1 whitespace-nowrap ${
              pathname === '/shop'
                ? 'text-white'
                : 'text-white hover:text-[#3B9EE8]'
            }`}
          >
            Shop
            {pathname === '/shop' && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#3B9EE8]" />
            )}
          </Link>

          {/* Brand Link */}
          <Link
            key="/brands"
            href="/brands"
            className={`text-sm font-medium transition-colors relative py-1 whitespace-nowrap ${
              pathname === '/brands' || pathname.startsWith('/brands')
                ? 'text-white'
                : 'text-white hover:text-[#3B9EE8]'
            }`}
          >
            Brand
            {(pathname === '/brands' || pathname.startsWith('/brands')) && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#3B9EE8]" />
            )}
          </Link>

          {/* Vehicle Selector Dropdown */}
          <div key="vehicle-selector" className="flex items-center">
            <HeaderVehicleSelector />
          </div>

          {/* Render remaining nav links (Accessories, Exterior, etc.) */}
          {NAV_LINKS.map((link) => {
            const isActive = pathname === link.href || 
              (link.href !== '/' && pathname.startsWith(link.href));
            
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`text-sm font-medium transition-colors relative py-1 whitespace-nowrap ${
                  isActive
                    ? 'text-white'
                    : 'text-white hover:text-[#3B9EE8]'
                }`}
              >
                {link.label}
                {isActive && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#3B9EE8]" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Mobile Search Bar */}
        {showMobileSearch && (
          <div className="md:hidden py-4 border-t border-gray-800">
            <ClientSearchSuggestions />
          </div>
        )}
      </div>

      {/* Mobile Menu */}
      <MobileMenu isOpen={showMobileMenu} onClose={() => setShowMobileMenu(false)} />
    </header>
  );
}