'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'react-hot-toast';
import Img from '../redesign/Img';
import { useCart } from '@/context/CartContext';
import { useCurrency } from '@/context/CurrencyContext';
import { useAddedToCartToast } from '@/hooks/useAddedToCartToast';
import { useFestivalOfferPrice } from '@/components/festival/FestivalOfferContext';
import type { CardFeeWaiver } from '@/hooks/queries/useCardFeeWaivers';
import { ZeroDeliveryRibbon, zeroDeliverySaveLabel } from '@/components/products/ZeroDeliveryRibbon';
import { savingsAmount } from '@/lib/savings';
import type { FestiveHeroPhoto } from './FestiveHome';

/** The four fee lines the Black Friday offer waives, in the receipt's order. */
const FREEBIES = ['shipping', 'packing', 'handling', 'other fees'] as const;

type Action =
  | { kind: 'add' }
  | { kind: 'link'; href: string; label: string };

/**
 * What the card's button does. Only a simple product with a known price that is in
 * stock now can go straight into the cart; everything else links somewhere honest.
 */
export function heroCardAction(p: FestiveHeroPhoto): Action {
  if (p.stock === 'backorder') {
    return { kind: 'link', href: `/consultation?product=${encodeURIComponent(p.name)}`, label: 'Backorder · Enquire' };
  }
  if (p.stock === 'out') return { kind: 'link', href: p.href, label: 'Sold out · View product' };
  if (p.variable) return { kind: 'link', href: p.href, label: 'Choose options' };
  const orderable = !!p.id && (p.price ?? 0) > 0 && (p.stock === 'in' || p.stock === 'low');
  return orderable ? { kind: 'add' } : { kind: 'link', href: p.href, label: 'View deal' };
}

/**
 * One of the three Black Friday hero products, "corner ribbon" design (owner, 2026-11-20):
 * photo with the red "Save ₹X+" tag and green "₹0 DELIVERY" ribbon, then a light panel
 * with the full name, the price (M.R.P. struck), a ₹0-fees checklist and a full-width
 * button.
 *
 * Honest by construction:
 *  - Every figure is the server's: the catalogue price (with a live festival offer applied
 *    by the same hook as the grid tiles) and the fee waiver from `useCardFeeWaivers`.
 *  - The ₹0 claims (ribbon, checklist, "Nothing extra") appear ONLY when the server sent a
 *    waiver, which it does only for products orderable now — never on backorder/sold out.
 *  - Adding to cart is optimistic (allowed for cart-add); the cart charges the server's
 *    figure, and a rejection rolls the badge back and shows the error.
 *
 * Markup: the photo-and-text area is one link to the product; the button is a sibling,
 * not nested inside the link (a button inside <a> is invalid and confuses screen readers).
 * Every panel row has a fixed height in CSS, so the waiver loading in shifts nothing.
 */
export default function BlackFridayHeroCard({
  p,
  waiver,
  pending,
  priority,
}: {
  p: FestiveHeroPhoto;
  waiver: CardFeeWaiver | null;
  /** Offer live, figures still loading: reserve the checklist's space. */
  pending: boolean;
  /** The first card's photo is a likely LCP element: fetch it early. */
  priority: boolean;
}) {
  const { formatPrice } = useCurrency();
  const { addToCart } = useCart();
  const notifyAdded = useAddedToCartToast();
  const [adding, setAdding] = useState(false);

  const offer = useFestivalOfferPrice(p.variable || !p.price ? null : p.price, p.festivalOfferSetting ?? null);
  const price = p.price ? (offer ? offer.finalPrice : p.price) : null;
  const mrp = p.price && p.originalPrice && savingsAmount(p.price, p.originalPrice) > 0 ? p.originalPrice : null;
  const action = heroCardAction(p);
  // A waiver is the server saying "₹0 delivery applies to this product right now".
  const free = action.kind === 'add' ? waiver : null;
  const saveLabel = zeroDeliverySaveLabel(free, (n) => formatPrice(n))
    ?? (p.save > 0 ? `Save ${formatPrice(p.save)}` : null);

  const onAdd = async () => {
    if (adding || !p.id || !p.price) return;
    setAdding(true);
    notifyAdded({ price: p.price, originalPrice: p.originalPrice });
    try {
      await addToCart(p.id, 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add to cart');
    } finally {
      setAdding(false);
    }
  };

  return (
    <article className="bfh-card" data-testid="bfh-card">
      <Link href={p.href} className="bfh-card-link">
        <span className="bfh-card-media">
          <Img src={p.src} alt={p.name} className="bfh-card-img" sizes="(max-width: 768px) 70vw, 210px" priority={priority} />
          {/* The shared diagonal ribbon (same as grid cards and the product page). */}
          {free && <ZeroDeliveryRibbon testId="bfh-zero-delivery" />}
          {saveLabel && <span className="bfh-card-tag">{saveLabel}</span>}
        </span>
        <span className="bfh-card-body">
          <span className="bfh-card-name">{p.name}</span>
          <span className="bfh-card-price" data-testid="bfh-card-price">
            {price !== null && <b>{formatPrice(price)}</b>}
            {mrp !== null && (
              <span className="bfh-card-mrp">
                M.R.P. <s>{formatPrice(mrp)}</s>
              </span>
            )}
          </span>
          <span className="bfh-card-perks" data-testid="bfh-card-perks">
            {free ? (
              <span className="bfh-card-checks" aria-label="Black Friday: ₹0 shipping, packing, handling and other fees">
                {FREEBIES.map((f) => (
                  <span key={f} className="bfh-card-check" aria-hidden="true">
                    <Tick />₹0 {f}
                  </span>
                ))}
              </span>
            ) : pending && action.kind === 'add' ? (
              <span className="bfh-card-checks-pending" aria-hidden="true" />
            ) : p.stock === 'backorder' ? (
              <span className="bfh-card-status">Made to order — we confirm the date</span>
            ) : p.stock === 'out' ? (
              <span className="bfh-card-status">Sold out for now</span>
            ) : null}
          </span>
        </span>
      </Link>
      {action.kind === 'add' ? (
        <button
          type="button"
          className="bfh-card-cta"
          onClick={onAdd}
          disabled={adding}
          aria-label={free ? `Add ${p.name} to cart — nothing extra to pay for delivery` : `Add ${p.name} to cart`}
          data-testid="bfh-card-add"
        >
          <CartIcon />
          <span>Add to cart{free && <span className="bfh-card-cta-sub">Nothing extra</span>}</span>
        </button>
      ) : (
        <Link href={action.href} className="bfh-card-cta bfh-card-cta-quiet" data-testid="bfh-card-view">
          {action.label}
        </Link>
      )}
    </article>
  );
}

function Tick() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" className="bfh-card-tick">
      <circle cx="8" cy="8" r="8" fill="currentColor" />
      <path d="M4.5 8.3l2.3 2.3 4.7-5" fill="none" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CartIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 4h2l2.4 11.2a1 1 0 001 .8h8.9a1 1 0 001-.8L20 8H6.2" />
      <circle cx="9.5" cy="20" r="1.4" />
      <circle cx="17" cy="20" r="1.4" />
    </svg>
  );
}
