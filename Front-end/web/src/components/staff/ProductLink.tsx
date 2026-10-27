'use client';

import type { ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import { productLinkHref, type ProductRef } from '@/lib/productLink';

/**
 * A product name (or photo) in the admin / team panels that opens the product's
 * page on the website.
 *
 * Always a NEW TAB: these sit inside half-filled order forms and order screens,
 * and leaving the page would lose the work. The click never bubbles, so a link
 * inside a clickable row or a picker can't also select, add or remove the line.
 * No product id (a custom item, a goodie) → the plain text, no dead link.
 */
export default function ProductLink({
  product,
  variantId = null,
  children,
  className = '',
  decorative = false,
}: {
  product: ProductRef;
  variantId?: string | null;
  children: ReactNode;
  className?: string;
  /**
   * The photo beside a name that is already a link: clickable, but skipped by
   * the keyboard and screen readers so they don't meet the same link twice.
   */
  decorative?: boolean;
}) {
  const href = productLinkHref(product, variantId);
  if (!href) return <>{children}</>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      title="Open on the website (new tab)"
      {...(decorative ? { tabIndex: -1, 'aria-hidden': true } : {})}
      className={decorative ? `block shrink-0 ${className}` : `hover:underline hover:decoration-gray-400 underline-offset-2 ${className}`}
    >
      {children}
      {!decorative && (
        <>
          <ExternalLink aria-hidden="true" className="ml-1 inline h-3 w-3 shrink-0 align-[-1px] text-gray-400" />
          <span className="sr-only"> (opens on the website in a new tab)</span>
        </>
      )}
    </a>
  );
}
