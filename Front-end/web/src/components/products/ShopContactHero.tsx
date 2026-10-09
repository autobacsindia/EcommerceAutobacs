'use client';

import Link from 'next/link';
import { Phone, CalendarCheck } from 'lucide-react';
import { capture } from '@/lib/analytics';
import { SUPPORT_PHONE_DISPLAY, SUPPORT_PHONE_TEL, whatsappLink } from '@/lib/contactInfo';

function WhatsAppGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.08c.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.22 1.36.19 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35zM12.04 21.5h-.01a9.45 9.45 0 0 1-4.82-1.32l-.35-.21-3.58.94.96-3.49-.23-.36a9.45 9.45 0 0 1-1.45-5.04c0-5.22 4.25-9.47 9.48-9.47 2.53 0 4.91.99 6.7 2.78a9.41 9.41 0 0 1 2.77 6.7c0 5.22-4.25 9.47-9.47 9.47zm8.06-17.53A11.3 11.3 0 0 0 12.04.63C5.76.63.65 5.74.65 12.02c0 2.01.52 3.97 1.52 5.69L.55 23.6l6.03-1.58a11.37 11.37 0 0 0 5.45 1.39h.01c6.28 0 11.39-5.11 11.39-11.39 0-3.04-1.18-5.9-3.33-8.05z" />
    </svg>
  );
}

/**
 * Slim "talk to an expert" strip for listing pages (the shop and every category).
 * It used to be a full-height hero carrying the page's <h1>, which pushed every
 * product below the first screen; the page title now lives in StorePageHeader and
 * this is a compact green band under it (styles: `.sp-help` in store.css).
 */
export default function ShopContactHero({
  title = 'Not sure what fits your car?',
  contactLine = 'Our specialists confirm fitment, price and availability before you buy.',
  placement = 'shop_hero',
}: {
  title?: string;
  contactLine?: string;
  /** Analytics label for where the buttons were clicked. */
  placement?: string;
} = {}) {
  return (
    <div className="sp-help">
      <div>
        <p className="sp-help-title">{title}</p>
        <p className="sp-help-sub">{contactLine}</p>
      </div>
      <div className="sp-help-actions">
        <a
          href={whatsappLink('Hi Autobacs India! I need help choosing a product.')}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => capture('contact_click', { channel: 'whatsapp', placement })}
          className="sh-btn sh-btn-outline"
        >
          <WhatsAppGlyph className="h-4 w-4 text-[#128C7E]" /> WhatsApp
        </a>
        <a
          href={`tel:${SUPPORT_PHONE_TEL}`}
          onClick={() => capture('contact_click', { channel: 'call', placement })}
          className="sh-btn sh-btn-ghost"
          aria-label={`Call ${SUPPORT_PHONE_DISPLAY}`}
        >
          <Phone className="h-4 w-4" /> Call us
        </a>
        <Link href="/consultation" className="sh-btn sh-btn-ghost">
          <CalendarCheck className="h-4 w-4" /> Book a consultation
        </Link>
      </div>
    </div>
  );
}
