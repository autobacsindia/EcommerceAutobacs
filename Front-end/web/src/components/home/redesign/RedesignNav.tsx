'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Img from './Img';
import RedesignVehicleMenu from './RedesignVehicleMenu';
import ProfileAvatar from './ProfileAvatar';
import { Search, Heart, Cart, Menu, Close, UserIcon } from './icons';
import { brand, navLinks } from './homeContent';
import { useAuth } from '@/context/AuthContext';

const VEHICLE_LABEL = 'Vehicle Makes';

export default function RedesignNav() {
  const router = useRouter();
  const { isAuthenticated } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState('');

  // Lock body scroll while the mobile menu is open.
  useEffect(() => {
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [menuOpen]);

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    if (!term) return;
    setSearchOpen(false);
    setMenuOpen(false);
    router.push(`/products/search?q=${encodeURIComponent(term)}`);
  };

  const accountHref = isAuthenticated ? '/profile' : '/login';
  const accountLabel = isAuthenticated ? 'My Account' : 'Sign In';

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

      {/* Desktop inline search */}
      <form className="nav-search nav-search-desktop" role="search" onSubmit={submitSearch}>
        <Search />
        <input
          type="text"
          placeholder="Search parts, brands…"
          aria-label="Search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </form>

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
        <Link href="/cart" className="icon-btn" title="Cart" aria-label="Cart">
          <Cart />
        </Link>
        <ProfileAvatar className="avatar nav-avatar" />
      </div>

      {/* Mobile search bar (revealed by the search toggle) */}
      {searchOpen && (
        <form className="nav-search-bar" role="search" onSubmit={submitSearch}>
          <Search width={17} height={17} />
          <input
            type="text"
            placeholder="Search parts, brands…"
            aria-label="Search"
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </form>
      )}

      {/* Mobile hamburger menu */}
      {menuOpen && (
        <div className="nav-mobile">
          {navLinks.map((l) =>
            l.label === VEHICLE_LABEL ? (
              <RedesignVehicleMenu key={l.label} variant="inline" />
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
          <Link href={accountHref} className="nav-mobile-row" onClick={() => setMenuOpen(false)}>
            <UserIcon width={16} height={16} />
            {accountLabel}
          </Link>
        </div>
      )}
    </nav>
  );
}
