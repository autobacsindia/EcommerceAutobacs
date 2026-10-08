import type { FC, SVGProps } from 'react';
import Link from 'next/link';
import Img from './Img';
import { Facebook, Instagram, YouTube, LinkedIn, Phone, Mail, WhatsApp, Headset, Lock } from './icons';
import { brand, footer } from './homeContent';
import { SUPPORT_PHONE_DISPLAY, SUPPORT_PHONE_TEL, SUPPORT_EMAIL, whatsappLink } from '@/lib/contactInfo';

const SOCIAL_ICONS: Record<string, FC<SVGProps<SVGSVGElement>>> = {
  Facebook,
  Instagram,
  YouTube,
  LinkedIn,
};

/*
  Ways to reach a person, first thing in the footer. The site already publishes
  each of these (floating buttons, Contact, Terms) — the footer is simply where a
  shopper looks for them, and it never showed any.
*/
const CONTACT = [
  { label: 'Call us', value: SUPPORT_PHONE_DISPLAY, href: `tel:${SUPPORT_PHONE_TEL}`, Icon: Phone, external: false },
  { label: 'WhatsApp', value: 'Chat with an expert', href: whatsappLink('Hi, I need help choosing a part.'), Icon: WhatsApp, external: true },
  { label: 'Email', value: SUPPORT_EMAIL, href: `mailto:${SUPPORT_EMAIL}`, Icon: Mail, external: false },
  { label: 'Consult a specialist', value: 'Free fitment advice', href: '/consultation', Icon: Headset, external: false },
] as const;

export default function RedesignFooter() {
  return (
    <footer className="footer">
      <div className="footer-contact">
        {CONTACT.map(({ label, value, href, Icon, external }) => {
          const body = (
            <>
              <span className="fc-icon" aria-hidden="true"><Icon /></span>
              <span className="fc-text">
                <span className="fc-label">{label}</span>
                <span className="fc-value">{value}</span>
              </span>
            </>
          );
          return href.startsWith('/') ? (
            <Link key={label} href={href} className="fc-item">{body}</Link>
          ) : (
            <a key={label} href={href} className="fc-item" {...(external && { target: '_blank', rel: 'noopener noreferrer' })}>{body}</a>
          );
        })}
      </div>

      <div className="footer-top">
        <div className="footer-brand">
          <div className="logo-f">
            {brand.logo ? (
              <Img src={brand.logo} alt={brand.logoAlt} className="logo-img footer-logo-img" sizes="200px" width={960} height={255} />
            ) : (
              <>
                {brand.name}
                <span>{brand.nameAccent}</span>
              </>
            )}
          </div>
          <p>{footer.blurb}</p>
          <form className="footer-newsletter" onSubmit={(e) => e.preventDefault()}>
            <input type="email" placeholder="Enter your email" aria-label="Email address" />
            <button type="submit">Subscribe</button>
          </form>
          {/* In the brand column, not the bottom bar: down there the fixed
              WhatsApp / call bubbles covered the last icon. */}
          <div className="social-links">
            {footer.social.map((s) => {
              const Icon = SOCIAL_ICONS[s.label];
              return (
                <a
                  key={s.label}
                  href={s.href}
                  aria-label={s.label}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Icon />
                </a>
              );
            })}
          </div>
        </div>

        {footer.columns.map((col) => (
          <div className="footer-col" key={col.title}>
            <h4>{col.title}</h4>
            <ul>
              {col.links.map((l) => (
                <li key={l.label}>
                  <Link href={l.href}>{l.label}</Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="footer-bottom">
        <p>{footer.copyright}</p>
        <p className="footer-secure">
          <Lock aria-hidden="true" /> Secure payments by Razorpay · UPI · Cards · Net Banking · EMI
        </p>
      </div>
    </footer>
  );
}
