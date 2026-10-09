import Link from 'next/link';
import { Stars } from './ProductTile';
import type { StoreReview } from './storeData';

/** Real customer reviews: their own stars; "Verified purchase" only when it is one. */
export default function ReviewStrip({ reviews }: { reviews: StoreReview[] }) {
  if (!reviews.length) return null;
  return (
    <section className="st-card" aria-labelledby="sh-reviews">
      <div className="st-row-head">
        <h2 id="sh-reviews" className="st-h2">What customers say</h2>
      </div>
      <div className="sh-reviews">
        {reviews.slice(0, 6).map((r, k) => (
          <article className="sh-review" key={k}>
            <Stars rating={r.rating} />
            <blockquote className="sh-review-quote">{r.quote}</blockquote>
            <div className="sh-review-who">
              <span className="sh-review-avatar" aria-hidden="true">{(r.name.trim()[0] || '?').toUpperCase()}</span>
              <span>
                <span className="sh-review-name">{r.name}</span>
                {r.verified && <span className="sh-review-verified">Verified purchase</span>}
              </span>
            </div>
            {r.product && <Link href={r.product.href} className="sh-review-product">{r.product.name}</Link>}
          </article>
        ))}
      </div>
    </section>
  );
}
