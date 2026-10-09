'use client';

import { usePathname } from 'next/navigation';
import { Phone } from 'lucide-react';
import { capture } from '@/lib/analytics';
import { SITE_URL } from '@/lib/siteUrl';
import { SUPPORT_PHONE_DISPLAY, SUPPORT_PHONE_TEL, whatsappLink } from '@/lib/contactInfo';

/** Not on staff/admin screens, nor in checkout where it would compete with Pay. */
function isSuppressed(pathname: string | null): boolean {
  if (!pathname) return false;
  return (
    pathname.startsWith('/admin') ||
    pathname === '/team' || pathname.startsWith('/team/') ||
    pathname.startsWith('/checkout') ||
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
 * Floating WhatsApp + Call buttons, bottom-right on every storefront page.
 *
 * On a product page the WhatsApp message carries the page link, so the sales
 * team knows which product the customer is asking about. On phones the stack
 * sits above the product page's sticky Add-to-cart bar instead of covering it.
 */
export default function ContactFab() {
  const pathname = usePathname();
  if (isSuppressed(pathname)) return null;

  const onProduct = isProductPage(pathname);
  const message = onProduct
    ? `Hi Autobacs India! I have a question about this product: ${SITE_URL}${pathname}`
    : 'Hi Autobacs India! I have a question.';

  return (
    <div
      className={`fixed right-4 z-40 flex flex-col gap-3 md:bottom-6 ${onProduct ? 'bottom-24' : 'bottom-5'}`}
    >
      <a
        href={whatsappLink(message)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Chat with us on WhatsApp"
        title="Chat on WhatsApp"
        onClick={() => capture('contact_click', { channel: 'whatsapp', path: pathname })}
        className="flex h-12 w-12 md:h-14 md:w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-lg shadow-black/20 ring-2 ring-white transition-transform hover:scale-105 focus:outline-none focus-visible:ring-[#e6a817]"
      >
        <WhatsAppIcon className="h-6 w-6 md:h-7 md:w-7" />
      </a>
      <a
        href={`tel:${SUPPORT_PHONE_TEL}`}
        aria-label={`Call us on ${SUPPORT_PHONE_DISPLAY}`}
        title={`Call ${SUPPORT_PHONE_DISPLAY}`}
        onClick={() => capture('contact_click', { channel: 'call', path: pathname })}
        className="flex h-12 w-12 md:h-14 md:w-14 items-center justify-center rounded-full bg-gold text-white shadow-lg shadow-[rgba(10,92,51,0.35)] ring-2 ring-white transition-transform hover:scale-105 hover:bg-[#0b6b3c] focus:outline-none focus-visible:ring-[#e6a817]"
      >
        <Phone className="h-5 w-5 md:h-6 md:w-6" />
      </a>
    </div>
  );
}
