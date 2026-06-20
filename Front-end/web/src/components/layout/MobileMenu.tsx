'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { X, Home, ShoppingBag, Tag, Car, Heart, Gift, User, LogOut } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { usePathname } from 'next/navigation';
import HeaderVehicleSelector from './HeaderVehicleSelector';
import type { NavCategory } from '@/lib/navCategories';

interface MobileMenuProps {
  isOpen: boolean;
  onClose: () => void;
  navCategories: NavCategory[];
}

export default function MobileMenu({ isOpen, onClose, navCategories }: MobileMenuProps) {
  const { isAuthenticated, user, logout } = useAuth();
  const pathname = usePathname();

  useEffect(() => {
    document.body.style.overflow = isOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    if (isOpen) document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const getIconForLink = (href: string) => {
    switch (href) {
      case '/': return <Home className="h-5 w-5" />;
      case '/shop': return <ShoppingBag className="h-5 w-5" />;
      case '/brands': return <Tag className="h-5 w-5" />;
      case '/vehicles': return <Car className="h-5 w-5" />;
      case '/wishlist': return <Heart className="h-5 w-5" />;
      case '/offers': return <Gift className="h-5 w-5" />;
      default: return <ShoppingBag className="h-5 w-5" />;
    }
  };

  const linkClass = (href: string) => {
    const isActive = pathname === href || (href !== '/' && pathname.startsWith(href));
    return `flex items-center gap-3 px-4 py-3 transition-colors font-condensed font-bold uppercase tracking-wide text-sm ${
      isActive
        ? 'bg-[#3B9EE8]/10 text-[#3B9EE8] border-l-2 border-[#3B9EE8]'
        : 'text-[#C4C4C4] hover:bg-[#161616] hover:text-white'
    }`;
  };

  const handleLogout = () => { logout(); onClose(); };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/70 z-40 animate-fadeIn"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-out Panel */}
      <div
        className="fixed top-0 right-0 h-full w-80 max-w-[85vw] bg-[#0E0E0E] border-l border-[#252525] shadow-2xl z-50 animate-slideInRight flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-label="Mobile navigation menu"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#252525]">
          <h2 className="text-lg font-condensed font-bold text-white uppercase tracking-widest">Menu</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-sm hover:bg-[#161616] transition-colors"
            aria-label="Close menu"
          >
            <X className="h-6 w-6 text-[#C4C4C4]" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto">
          <ul className="py-2">
            <li>
              <Link href="/" onClick={onClose} className={linkClass('/')}>
                <Home className="h-5 w-5" /><span>Home</span>
              </Link>
            </li>
            <li>
              <Link href="/shop" onClick={onClose} className={linkClass('/shop')}>
                <ShoppingBag className="h-5 w-5" /><span>Shop</span>
              </Link>
            </li>
            <li>
              <Link href="/brands" onClick={onClose} className={linkClass('/brands')}>
                <Tag className="h-5 w-5" /><span>Brand</span>
              </Link>
            </li>

            {/* Vehicle Selector */}
            <li className="px-4 py-3 border-t border-b border-[#252525] my-2">
              <div className="text-xs font-condensed font-bold text-[#3B9EE8] uppercase tracking-widest mb-2">Select Your Vehicle</div>
              <HeaderVehicleSelector />
            </li>

            {[...navCategories, { label: 'Offers', href: '/offers' }].map((link) => (
              <li key={link.href}>
                <Link href={link.href} onClick={onClose} className={linkClass(link.href)}>
                  {getIconForLink(link.href)}
                  <span>{link.label}</span>
                </Link>
              </li>
            ))}
          </ul>

          <div className="border-t border-[#252525] my-2" />

          {/* User section */}
          <div className="py-2">
            {isAuthenticated ? (
              <>
                <Link
                  href="/profile"
                  onClick={onClose}
                  className={linkClass('/profile')}
                >
                  <User className="h-5 w-5" />
                  <div className="flex flex-col">
                    <span>{user?.name}</span>
                    <span className="text-xs text-[#555555] font-body normal-case tracking-normal">{user?.email}</span>
                  </div>
                </Link>
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-3 px-4 py-3 text-red-400 hover:bg-[#161616] hover:text-red-300 transition-colors w-full font-condensed font-bold uppercase tracking-wide text-sm"
                >
                  <LogOut className="h-5 w-5" />
                  <span>Logout</span>
                </button>
              </>
            ) : (
              <>
                <Link
                  href="/login"
                  onClick={onClose}
                  className="flex items-center gap-3 px-4 py-3 text-[#C4C4C4] hover:bg-[#161616] hover:text-white transition-colors font-condensed font-bold uppercase tracking-wide text-sm"
                >
                  <User className="h-5 w-5" /><span>Login</span>
                </Link>
                <div className="px-4 mt-2">
                  <Link
                    href="/register"
                    onClick={onClose}
                    className="flex items-center justify-center gap-2 bg-[#3B9EE8] hover:bg-[#1A6FB5] text-white px-4 py-3 rounded-sm transition-colors font-condensed font-bold uppercase tracking-widest text-sm"
                  >
                    Sign Up
                  </Link>
                </div>
              </>
            )}
          </div>
        </nav>
      </div>

      <style jsx>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
        .animate-fadeIn { animation: fadeIn 200ms ease-in-out; }
        .animate-slideInRight { animation: slideInRight 300ms ease-in-out; }
      `}</style>
    </>
  );
}
