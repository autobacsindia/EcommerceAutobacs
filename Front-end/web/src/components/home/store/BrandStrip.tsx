import Link from 'next/link';
import Img from '../redesign/Img';
import type { StoreBrand } from './storeData';

/** Brand logos (brands with the most products first), each to its brand page. */
export default function BrandStrip({ brands }: { brands: StoreBrand[] }) {
  if (brands.length < 4) return null;
  return (
    <section className="st-card" aria-labelledby="sh-brands">
      <div className="st-row-head">
        <h2 id="sh-brands" className="st-h2">Shop by brand</h2>
        <Link href="/brands" className="st-link">See all brands</Link>
      </div>
      <div className="sh-brands">
        {brands.map((b) => (
          <Link key={b.href} href={b.href} className="sh-brand" aria-label={b.name}>
            <Img src={b.logo} alt={b.name} className="sh-brand-img" sizes="140px" />
          </Link>
        ))}
      </div>
    </section>
  );
}
