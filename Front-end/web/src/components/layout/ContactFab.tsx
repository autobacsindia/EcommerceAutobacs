'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { MessageCircle, Phone, X } from 'lucide-react';
import { trackContact } from '@/lib/contactTracking';
import { useFloatingClearance } from '@/lib/floatingClearance';
import { isHelpBotSuppressed, OPEN_HELP_BOT_EVENT } from '@/components/help/helpBotVisibility';
import { SITE_URL } from '@/lib/siteUrl';
import { SUPPORT_PHONE_DISPLAY, SUPPORT_PHONE_TEL, whatsappLink } from '@/lib/contactInfo';

/**
 * Not on staff/admin screens, nor in cart/checkout where it would compete with
 * the buttons that finish the order (on phones it sat on the cart's delete and
 * "Clear cart" buttons).
 */
function isSuppressed(pathname: string | null): boolean {
  if (!pathname) return false;
  return (
    pathname.startsWith('/admin') ||
    pathname === '/team' || pathname.startsWith('/team/') ||
    pathname === '/cart' ||
    pathname.startsWith('/checkout') ||
    pathname === '/careers' || pathname.startsWith('/careers/') ||
    pathname.startsWith('/staff-invite')
  );
}

/** A product page: on phones its sticky Add-to-cart bar owns the bottom edge. */
const isProductPage = (pathname: string | null) =>
  !!pathname && /^\/products\/(?!search(\/|$))[^/]+$/.test(pathname);

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.08c.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.22 1.36.19 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35zM12.04 21.5h-.01a9.45 9.45 0 0 1-4.82-1.32l-.35-.21-3.58.94.96-3.49-.23-.36a9.45 9.45 0 0 1-1.45-5.04c0-5.22 4.25-9.47 9.48-9.47 2.53 0 4.91.99 6.7 2.78a9.41 9.41 0 0 1 2.77 6.7c0 5.22-4.25 9.47-9.47 9.47zm8.06-17.53A11.3 11.3 0 0 0 12.04.63C5.76.63.65 5.74.65 12.02c0 2.01.52 3.97 1.52 5.69L.55 23.6l6.03-1.58a11.37 11.37 0 0 0 5.45 1.39h.01c6.28 0 11.39-5.11 11.39-11.39 0-3.04-1.18-5.9-3.33-8.05z" />
    </svg>
  );
}

/**
 * Floating contact buttons, bottom-right on every storefront page.
 *
 * On a product page the WhatsApp message carries the page link, so the sales
 * team knows which product the customer is asking about.
 *
 * Desktop (md+): separate WhatsApp + Call buttons, stacked above the help-chat
 * launcher (HelpBot, bottom-6) from bottom-28 — unchanged.
 *
 * Phones: ONE "Contact us" button that opens a small menu — WhatsApp, Call,
 * Chat with us (Batch 3, owner-approved 2026-11-21; replaces the 2026-11-15
 * one-button-per-channel layout). Three bubbles plus the side tab sat on Add to
 * cart, Buy now and the wishlist heart on a 375px product page, and phone
 * buyers were paying half as often as desktop. So on phones it:
 *   - sits 16px above the sticky buy bar while that bar shows (the bar reports
 *     its live height, incl. the taller sale variant), else 16px off the bottom;
 *   - fades out (and leaves the tab order) while the in-page Add to cart /
 *     Buy now / wishlist block is on screen.
 * Both add the iOS home-bar inset. HelpBot's phone panel opens above it.
 * Each channel tap is still recorded once (trackContact); opening the menu is not.
 */
export default function ContactFab() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const { buyBarHeight, buyButtonsInView } = useFloatingClearance();
  const rootRef = useRef<HTMLDivElement>(null);

  // A new page closes the menu — it must not follow the customer around.
  useEffect(() => { setOpen(false); }, [pathname]);
  // Stepping aside for the buy buttons also closes it.
  useEffect(() => { if (buyButtonsInView) setOpen(false); }, [buyButtonsInView]);

  // Escape or a tap anywhere else closes the menu.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  if (isSuppressed(pathname)) return null;

  const onProduct = isProductPage(pathname);
  const message = onProduct
    ? `Hi Autobacs India! I have a question about this product: ${SITE_URL}${pathname}`
    : 'Hi Autobacs India! I have a question.';
  const chatAvailable = !isHelpBotSuppressed(pathname);
  const ring = 'shadow-xl shadow-black/30 ring-[3px] ring-white transition-transform hover:scale-105 focus:outline-none focus-visible:ring-[#6fdc9c]';
  // Phones: a labelled pill inside the open menu, hidden while it is closed.
  // Desktop: the familiar round icon button, always shown.
  const item = `${open ? 'flex' : 'hidden'} md:flex h-12 items-center justify-center gap-2 rounded-full pl-4 pr-5 text-[15px] font-semibold md:h-14 md:w-14 md:p-0`;
  const label = 'md:hidden';
  // Phones only: step aside while Add to cart / Buy now / wishlist are on screen.
  const away = buyButtonsInView
    ? 'max-md:pointer-events-none max-md:invisible max-md:translate-y-3 max-md:opacity-0'
    : '';

  return (
    <>
    {/* Phones: empty room after the footer, as tall as the Contact button
        (16px + 48px) plus a little air, so the last price/link on any page can
        scroll clear of it. On a product page the sticky buy bar reserves its own
        room below this. Static height, so it never shifts the page. */}
    <div aria-hidden="true" data-testid="fab-clearance" className="h-[calc(76px_+_env(safe-area-inset-bottom))] md:hidden" />
    <div
      ref={rootRef}
      data-testid="contact-fab"
      // Lifted with a transform, not `bottom`: moving a box by `bottom` counts
      // as a layout shift (CLS), a transform does not. The bar is md:hidden, so
      // the lift is always 0 on desktop.
      style={{ transform: `translateY(-${buyBarHeight}px)` }}
      className={`fixed right-4 z-40 flex flex-col items-end gap-3 bottom-[calc(16px_+_env(safe-area-inset-bottom))] md:bottom-28 transition-[opacity,transform,translate,visibility] duration-200 motion-reduce:transition-none ${away}`}
    >
      {chatAvailable && (
        <button
          type="button"
          aria-label="Chat with us"
          onClick={() => {
            trackContact('chat', pathname);
            setOpen(false);
            window.dispatchEvent(new Event(OPEN_HELP_BOT_EVENT));
          }}
          // Phones only: desktop keeps HelpBot's own launcher.
          className={`${open ? 'flex' : 'hidden'} h-12 items-center gap-2 rounded-full bg-[#121414] pl-4 pr-5 text-[15px] font-semibold text-[#fff] md:hidden ${ring}`}
        >
          <MessageCircle className="h-5 w-5" aria-hidden="true" />
          Chat with us
        </button>
      )}
      <a
        href={whatsappLink(message)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Chat with us on WhatsApp"
        title="Chat on WhatsApp"
        onClick={() => { trackContact('whatsapp', pathname); setOpen(false); }}
        className={`${item} bg-[#25D366] text-[#fff] ${ring}`}
      >
        <WhatsAppIcon className="h-6 w-6 md:h-7 md:w-7" />
        <span className={label}>WhatsApp</span>
      </a>
      <a
        href={`tel:${SUPPORT_PHONE_TEL}`}
        aria-label={`Call us on ${SUPPORT_PHONE_DISPLAY}`}
        title={`Call ${SUPPORT_PHONE_DISPLAY}`}
        onClick={() => { trackContact('call', pathname); setOpen(false); }}
        className={`${item} bg-[#0a5c33] text-[#fff] hover:bg-[#0b6b3c] ${ring}`}
      >
        <Phone className="h-5 w-5 md:h-6 md:w-6" />
        <span className={label}>Call us</span>
      </a>
      {/* Phones: the one button. */}
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={open ? 'Close contact options' : 'Contact us'}
        onClick={() => setOpen((v) => !v)}
        className={`flex h-12 items-center gap-2 rounded-full bg-[#0a5c33] px-4 text-[15px] font-semibold text-[#fff] md:hidden ${ring}`}
      >
        {open ? <X className="h-5 w-5" aria-hidden="true" /> : <MessageCircle className="h-5 w-5" aria-hidden="true" />}
        <span>{open ? 'Close' : 'Contact us'}</span>
      </button>
    </div>
    </>
  );
}
