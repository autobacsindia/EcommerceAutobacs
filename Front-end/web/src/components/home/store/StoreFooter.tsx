import Link from 'next/link';
import Img from '../redesign/Img';
import { brand, footer } from '../redesign/homeContent';
import { SUPPORT_PHONE_DISPLAY, SUPPORT_PHONE_TEL, SUPPORT_EMAIL, whatsappLink } from '@/lib/contactInfo';

/**
 * Light footer with a green band: "Back to top", the contact strip, every existing
 * footer column, social links and the copyright — same content as the site footer,
 * in the store's light theme.
 */
export default function StoreFooter() {
  return (
    <footer className="sf">
      <a href="#top" className="sf-top">Back to top</a>
      <div className="sf-band">
        <a href={`tel:${SUPPORT_PHONE_TEL}`}><strong>Call us</strong><span>{SUPPORT_PHONE_DISPLAY}</span></a>
        <a href={whatsappLink('Hi, I need help choosing a part.')} target="_blank" rel="noopener noreferrer"><strong>WhatsApp</strong><span>Chat with an expert</span></a>
        <a href={`mailto:${SUPPORT_EMAIL}`}><strong>Email</strong><span>{SUPPORT_EMAIL}</span></a>
        <Link href="/consultation"><strong>Consult a specialist</strong><span>Free fitment advice</span></Link>
      </div>
      <div className="sf-main">
        <div className="sf-brand">
          <span className="sf-logo-chip"><Img src={brand.logo} alt={brand.logoAlt} className="sf-logo" sizes="160px" width={960} height={255} /></span>
          <p>{footer.blurb}</p>
          <div className="sf-social">
            {footer.social.map((s) => (
              <a key={s.label} href={s.href} target="_blank" rel="noopener noreferrer">{s.label}</a>
            ))}
          </div>
        </div>
        {footer.columns.map((col) => (
          <div className="sf-col" key={col.title}>
            <h3>{col.title}</h3>
            <ul>
              {col.links.map((l) => (
                <li key={l.label}><Link href={l.href}>{l.label}</Link></li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="sf-bottom">
        <p>{footer.copyright}</p>
        <p>Secure payments by Razorpay · UPI · Cards · Net Banking · EMI</p>
      </div>
    </footer>
  );
}
