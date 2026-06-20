'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import HeaderVehicleSelector from './HeaderVehicleSelector';
import type { NavCategory } from '@/lib/navCategories';

export default function HeaderNav({ categories }: { categories: NavCategory[] }) {
  const pathname = usePathname();

  // Categories come from the live data (resolved to real slugs); Offers is a
  // standalone page, kept as a trailing static link to match the existing nav.
  const navLinks: NavCategory[] = [...categories, { label: 'Offers', href: '/offers' }];

  return (
    <nav className="hidden md:flex items-center justify-between gap-2 w-full h-10" data-version="v4">
      <Link
        href="/shop"
        className={`text-sm font-medium transition-colors relative py-1 whitespace-nowrap ${
          pathname === '/shop' ? 'text-white' : 'text-white hover:text-[#3B9EE8]'
        }`}
      >
        Shop
        {pathname === '/shop' && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#3B9EE8]" />}
      </Link>

      <Link
        href="/brands"
        className={`text-sm font-medium transition-colors relative py-1 whitespace-nowrap ${
          pathname === '/brands' || pathname.startsWith('/brands') ? 'text-white' : 'text-white hover:text-[#3B9EE8]'
        }`}
      >
        Brand
        {(pathname === '/brands' || pathname.startsWith('/brands')) && (
          <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#3B9EE8]" />
        )}
      </Link>

      <div className="flex items-center">
        <HeaderVehicleSelector />
      </div>

      {navLinks.map((link) => {
        const isActive = pathname === link.href || (link.href !== '/' && pathname.startsWith(link.href));
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`text-sm font-medium transition-colors relative py-1 whitespace-nowrap ${
              isActive ? 'text-white' : 'text-white hover:text-[#3B9EE8]'
            }`}
          >
            {link.label}
            {isActive && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#3B9EE8]" />}
          </Link>
        );
      })}
    </nav>
  );
}
