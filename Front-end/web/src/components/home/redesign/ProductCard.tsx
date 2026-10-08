import Link from 'next/link';
import Img from './Img';
import { ArrowRight } from './icons';
import type { ProductItem } from './homeContent';

/**
 * Driver's Choice card. The name and price used to be laid over the product photo
 * behind a dark gradient, where busy shots made them hard to read and the photo
 * itself was dimmed. Now the photo sits in its own lit panel and the details are on
 * a solid card body, with one obvious action.
 */
export default function ProductCard({ p, price, className = '' }: { p: ProductItem; price: string; className?: string }) {
  return (
    <Link href={p.href} className={`pc-card ${className}`.trim()}>
      <div className="pc-media">
        <Img src={p.image} alt={p.name} className="pc-img" sizes="(max-width: 768px) 85vw, 320px" />
        {p.category && <span className="pc-cat">{p.category}</span>}
      </div>
      <div className="pc-body">
        {p.brand && <div className="pc-brand">{p.brand}</div>}
        <div className="pc-name">{p.name}</div>
        <div className="pc-foot">
          <span className="pc-price">{price}</span>
          <span className="pc-cta">
            View <ArrowRight />
          </span>
        </div>
      </div>
    </Link>
  );
}
