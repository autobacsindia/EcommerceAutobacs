'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import Img from '../redesign/Img';
import { brand } from '../redesign/homeContent';
import { useAuth } from '@/context/AuthContext';
import { useCart } from '@/context/CartContext';
import { loginHref } from '@/lib/utils';
import { SUPPORT_PHONE_TEL, whatsappLink } from '@/lib/contactInfo';
import VehiclePicker from './VehiclePicker';
import './store.css';

/** A department link: the home page passes StoreCategory, other pages the nav list. */
export type HeaderCategory = { name: string; href: string; slug?: string };

/**
 * Dark top bar (the white ROAVION logo needs it), Amazon-style: logo · vehicle ·
 * big search · account & orders · cart. Under it, the green category bar. On phones:
 * menu · logo · account · cart, then a full-width search, then the vehicle chip.
 */
export default function StoreHeader({ categories }: { categories: HeaderCategory[] }) {
  const router = useRouter();
  const pathname = usePathname() || '/';
  const { isAuthenticated, user } = useAuth();
  const { itemCount } = useCart();
  const [q, setQ] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    if (term) router.push(`/products/search?q=${encodeURIComponent(term)}`);
  };

  const firstName = (user?.name || '').trim().split(/\s+/)[0];
  const accountHref = isAuthenticated ? '/profile' : loginHref('/profile');
  const cartLabel = itemCount > 0 ? `Cart, ${itemCount} item${itemCount === 1 ? '' : 's'}` : 'Cart';

  const barLinks = [
    { label: "Today's Deals", href: '/offers' },
    ...categories.slice(0, 9).map((c) => ({ label: c.name, href: c.href })),
    { label: 'Vehicle Makes', href: '/vehicles' },
  ];
  // The department you are in is underlined, so the bar doubles as a "you are here".
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="sh-header">
      <div className="sh-top">
        <button type="button" className="sh-burger" aria-label="Open menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}>
          <span /><span /><span />
        </button>
        <Link href="/" className="sh-logo" aria-label={brand.logoAlt}>
          <Img src={brand.logo} alt={brand.logoAlt} className="sh-logo-img" sizes="(max-width: 768px) 140px, 190px" width={960} height={255} priority />
        </Link>
        <span className="sh-divider sh-only-desktop" aria-hidden="true" />
        <div className="sh-only-desktop"><VehiclePicker /></div>
        <Link href={accountHref} className="sh-account">
          <span className="sh-small">{isAuthenticated ? `Hello, ${firstName || 'there'}` : 'Hello, sign in'}</span>
          <span className="sh-big">Account &amp; Lists</span>
        </Link>
        <Link href="/orders" className="sh-orders sh-only-desktop">
          <span className="sh-small">Returns</span>
          <span className="sh-big">&amp; Orders</span>
        </Link>
        <form className="sh-search" role="search" onSubmit={submit}>
          <svg className="sh-search-ico" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search parts, brands or your car model"
            aria-label="Search products"
          />
          <button type="submit" className="sh-go" aria-label="Search">Go</button>
        </form>
        <Link href="/cart" className="sh-cart" aria-label={cartLabel}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M3 4h2l2.2 10.2a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.5-1.1L21 8H6.2" /><circle cx="9.5" cy="19.5" r="1.4" /><circle cx="17" cy="19.5" r="1.4" /></svg>
          <span className="sh-cart-count" aria-hidden="true">{itemCount > 99 ? '99+' : itemCount}</span>
        </Link>
      </div>

      {/* Phones: vehicle chip on its own row, under the search */}
      <div className="sh-mobile-vehicle"><VehiclePicker variant="bar" /></div>

      <nav className="sh-bar" aria-label="Shop departments">
        <button type="button" className="sh-bar-all" onClick={() => setMenuOpen(true)}>
          <span className="sh-bar-burger" aria-hidden="true"><span /><span /><span /></span> All
        </button>
        <span className="sh-bar-sep" aria-hidden="true" />
        {barLinks.map((l) => (
          <Link key={l.label} href={l.href} className={isActive(l.href) ? 'is-active' : undefined} aria-current={isActive(l.href) ? 'page' : undefined}>
            {l.label}
          </Link>
        ))}
        <Link href="/track" className={`sh-bar-track${isActive('/track') ? ' is-active' : ''}`}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M3 6h11v9H3zM14 9h4l3 3v3h-7" /><circle cx="7" cy="17" r="1.8" /><circle cx="17" cy="17" r="1.8" /></svg>
          Track Order
        </Link>
      </nav>

      {/* Portalled to <body>: the sticky header is its own stacking context, which would
          otherwise cap the drawer under the floating WhatsApp / call / Need-help buttons. */}
      {menuOpen && createPortal(
        <div className="sh-theme sh-drawer-wrap" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" className="sh-drawer-scrim" aria-label="Close menu" onClick={() => setMenuOpen(false)} />
          <div className="sh-drawer">
            <div className="sh-drawer-head">
              <Link href={accountHref} onClick={() => setMenuOpen(false)}>
                {isAuthenticated ? `Hello, ${firstName || 'there'}` : 'Hello, sign in'}
              </Link>
              <button type="button" className="sh-drawer-close" aria-label="Close menu" onClick={() => setMenuOpen(false)}>✕</button>
            </div>
            <div className="sh-drawer-body">
              <p className="sh-drawer-title">Shop by category</p>
              {categories.map((c) => (
                <Link key={c.slug || c.href} href={c.href} onClick={() => setMenuOpen(false)}>{c.name}</Link>
              ))}
              <p className="sh-drawer-title">Help &amp; offers</p>
              <Link href="/offers" onClick={() => setMenuOpen(false)}>Today&apos;s Deals</Link>
              <Link href="/vehicles" onClick={() => setMenuOpen(false)}>Vehicle Makes</Link>
              <Link href="/track" onClick={() => setMenuOpen(false)}>Track Order</Link>
              <Link href="/orders" onClick={() => setMenuOpen(false)}>Returns &amp; Orders</Link>
              <Link href="/wishlist" onClick={() => setMenuOpen(false)}>Wishlist</Link>
              <Link href="/consultation" onClick={() => setMenuOpen(false)}>Consult a specialist</Link>
              <div className="sh-drawer-contact">
                <a href={`tel:${SUPPORT_PHONE_TEL}`} className="sh-btn sh-btn-outline">Call us</a>
                <a href={whatsappLink('Hi, I need help choosing a part.')} className="sh-btn sh-btn-wa" target="_blank" rel="noopener noreferrer">WhatsApp</a>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </header>
  );
}
