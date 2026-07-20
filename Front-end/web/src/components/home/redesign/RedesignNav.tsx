'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Img from './Img';
import RedesignVehicleMenu from './RedesignVehicleMenu';
import RedesignNavSearch from './RedesignNavSearch';
import ProfileAvatar from './ProfileAvatar';
import KarmaBadge from '@/components/profile/KarmaBadge';
import { CheckCircle2 } from 'lucide-react';
import { Search, Heart, Cart, Menu, Close, UserIcon } from './icons';
import { brand, navLinks } from './homeContent';
import { useAuth } from '@/context/AuthContext';
import { useCart } from '@/context/CartContext';

const VEHICLE_LABEL = 'Vehicle Makes';

export default function RedesignNav() {
  const { isAuthenticated, user } = useAuth();
  const { itemCount } = useCart();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  // Lock body scroll while the mobile menu is open.
  useEffect(() => {
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [menuOpen]);

  return (
    <nav className="main-nav" id="hr-nav">
      {/* Mobile-only: burger on the left */}
      <button
        type="button"
        className="nav-burger"
        aria-label={menuOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={menuOpen}
        onClick={() => {
          setMenuOpen((v) => !v);
          setSearchOpen(false);
        }}
      >
        {menuOpen ? <Close /> : <Menu />}
      </button>

      <Link href="/" className="logo" aria-label={brand.logoAlt} onClick={() => setMenuOpen(false)}>
        {brand.logo ? (
          <Img src={brand.logo} alt={brand.logoAlt} className="logo-img" />
        ) : (
          <>
            {brand.name}
            <span>{brand.nameAccent}</span>
          </>
        )}
      </Link>

      <div className="nav-links">
        {navLinks.map((l) =>
          l.label === VEHICLE_LABEL ? (
            <RedesignVehicleMenu key={l.label} variant="dropdown" />
          ) : (
            <Link key={l.label} href={l.href}>
              {l.label}
            </Link>
          )
        )}
      </div>

      {/* Desktop inline search (live suggestions + recent searches) */}
      <RedesignNavSearch
        variant="desktop"
        onNavigate={() => {
          setSearchOpen(false);
          setMenuOpen(false);
        }}
      />

      <div className="actions">
        {/* Mobile-only: search toggle */}
        <button
          type="button"
          className="icon-btn nav-search-toggle"
          aria-label="Search"
          aria-expanded={searchOpen}
          onClick={() => {
            setSearchOpen((v) => !v);
            setMenuOpen(false);
          }}
        >
          <Search width={19} height={19} />
        </button>

        {/* Desktop-only: wishlist + profile (moved into the menu on mobile) */}
        <Link href="/wishlist" className="icon-btn nav-wishlist" title="Wishlist" aria-label="Wishlist">
          <Heart />
        </Link>
        <Link
          href="/cart"
          className="icon-btn"
          title="Cart"
          aria-label={itemCount > 0 ? `Cart, ${itemCount} item${itemCount === 1 ? '' : 's'}` : 'Cart'}
        >
          <Cart />
          {itemCount > 0 && (
            <span className="badge" aria-hidden="true">
              {itemCount > 99 ? '99+' : itemCount}
            </span>
          )}
        </Link>
        <ProfileAvatar className="avatar nav-avatar" />
      </div>

      {/* Mobile search bar (revealed by the search toggle) */}
      {searchOpen && (
        <RedesignNavSearch
          variant="mobile"
          onNavigate={() => {
            setSearchOpen(false);
            setMenuOpen(false);
          }}
        />
      )}

      {/* Mobile hamburger menu */}
      {menuOpen && (
        <div className="nav-mobile">
          {isAuthenticated ? (
            <div className="nav-mobile-account">
              <Link href="/profile" className="nav-mobile-account-main" onClick={() => setMenuOpen(false)}>
                <span className="avatar nav-mobile-account-avatar">
                  {user?.avatarUrl ? (
                    <Img src={user.avatarUrl} alt={user?.name || 'Profile'} />
                  ) : (
                    <span className="avatar-fallback">
                      <UserIcon />
                    </span>
                  )}
                </span>
                <span className="nav-mobile-account-text">
                  <span className="nav-mobile-account-name">{user?.name}</span>
                  <span className="nav-mobile-account-email">
                    <span className="nav-mobile-account-email-text">{user?.email}</span>
                    {user?.isVerified && (
                      <span className="nav-mobile-account-tick" title="Email verified" aria-label="Email verified">
                        <CheckCircle2 width={14} height={14} />
                      </span>
                    )}
                  </span>
                </span>
              </Link>
              <KarmaBadge />
            </div>
          ) : (
            <Link href="/login" className="nav-mobile-row" onClick={() => setMenuOpen(false)}>
              <UserIcon width={16} height={16} />
              Sign In
            </Link>
          )}
          {navLinks.map((l) =>
            l.label === VEHICLE_LABEL ? (
              <RedesignVehicleMenu key={l.label} variant="inline" onNavigate={() => setMenuOpen(false)} />
            ) : (
              <Link key={l.label} href={l.href} onClick={() => setMenuOpen(false)}>
                {l.label}
              </Link>
            )
          )}
          <Link href="/wishlist" className="nav-mobile-row" onClick={() => setMenuOpen(false)}>
            <Heart width={16} height={16} />
            Wishlist
          </Link>
        </div>
      )}
    </nav>
  );
}
