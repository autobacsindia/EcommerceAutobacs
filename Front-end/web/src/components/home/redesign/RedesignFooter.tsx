import Link from 'next/link';
import Img from './Img';
import { Instagram, YouTube, LinkedIn } from './icons';
import { brand, footer } from './homeContent';

export default function RedesignFooter() {
  return (
    <footer className="footer">
      <div className="footer-top">
        <div className="footer-brand">
          <div className="logo-f">
            {brand.logo ? (
              <Img src={brand.logo} alt={brand.logoAlt} className="logo-img footer-logo-img" />
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
        <div className="social-links">
          <a href="#" aria-label="Instagram">
            <Instagram />
          </a>
          <a href="#" aria-label="YouTube">
            <YouTube />
          </a>
          <a href="#" aria-label="LinkedIn">
            <LinkedIn />
          </a>
        </div>
      </div>
    </footer>
  );
}
