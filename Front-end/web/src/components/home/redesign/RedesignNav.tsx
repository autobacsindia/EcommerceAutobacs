'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Img from './Img';
import RedesignVehicleMenu from './RedesignVehicleMenu';
import RedesignNavSearch from './RedesignNavSearch';
import ProfileAvatar from './ProfileAvatar';
import KarmaBadge from '@/components/profile/KarmaBadge';
import { CheckCircle2, Handshake } from 'lucide-react';
import { Search, Heart, Cart, Menu, Close, UserIcon } from './icons';
import { brand, navLinks } from './homeContent';
import { useAuth } from '@/context/AuthContext';
import { useMyAffiliate } from '@/hooks/queries/useAffiliate';
import { loginHref } from '@/lib/utils';
import { useCart } from '@/context/CartContext';

const VEHICLE_LABEL = 'Vehicle Makes';

export default function RedesignNav() {
  const { isAuthenticated, user } = useAuth();
  const { itemCount } = useCart();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  /*
    Affiliate-ness is DATA, not a role (there is no `affiliate` in User.role), so
    deciding whether to show the row costs a request.

    Gated on `menuOpen` so it costs NOTHING until someone actually opens the menu —
    this nav mounts on every route, and the overwhelming majority of signed-in users
    will never be affiliates. By the time it does fire, the answer is usually already
    cached under `affiliateKeys.me()` from /profile or the dashboard itself.
  */
  const { data: affiliateData } = useMyAffiliate(menuOpen && isAuthenticated);
  const affiliateStatus = affiliateData?.affiliate?.status;
  const showAffiliateLink = affiliateStatus === 'active' || affiliateStatus === 'suspended';

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
          /* `priority` + `sizes` are load-bearing, not decoration. This sits in
             the fixed nav — always above the fold — but defaulted to
             loading="lazy" with no srcSet, so it was discovered late AND
             downloaded as the 254 KB source PNG. Lighthouse named this exact
             <img> as the home page's LCP element at 3.8 s (630 ms of that pure
             lazy-discovery delay). `sizes` mirrors the .logo-img CSS cap
             (200px desktop / 150px <=768px, see home-redesign.css) so the
             browser takes a ~10 KB ladder rung instead. */
          <Img
            src={brand.logo}
            alt={brand.logoAlt}
            className="logo-img"
            sizes="(max-width: 768px) 150px, 200px"
            width={820}
            height={315}
            priority
          />
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
                    <Img src={user.avatarUrl} alt={user?.name || 'Profile'} sizes="34px" />
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
            <Link href={loginHref('/profile')} className="nav-mobile-row" onClick={() => setMenuOpen(false)}>
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
          {/* Suspended affiliates get the link too — their past earnings are still there. */}
          {showAffiliateLink && (
            <Link href="/account/affiliate" className="nav-mobile-row" onClick={() => setMenuOpen(false)}>
              <Handshake width={16} height={16} />
              Affiliate Dashboard
            </Link>
          )}
        </div>
      )}
    </nav>
  );
}
