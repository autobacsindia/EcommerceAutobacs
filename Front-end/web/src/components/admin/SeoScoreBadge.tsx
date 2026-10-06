import Link from 'next/link';
import { productSeoScore, seoRating, type ScorableProduct } from '@/lib/seoScore';

const TONE = {
  good: 'bg-green-50 text-green-700 border-green-200',
  'needs-work': 'bg-amber-50 text-amber-700 border-amber-200',
  poor: 'bg-red-50 text-red-700 border-red-200',
} as const;

/**
 * The product's SEO score for the admin list — the same number the editor's SEO
 * panel shows when the product is opened (base score, no focus keyword).
 * Links to the editor, where the panel lists exactly what to fix.
 */
export default function SeoScoreBadge({ product, href }: { product: ScorableProduct; href: string }) {
  const score = productSeoScore(product);
  const { rating, label } = seoRating(score);
  return (
    <Link
      href={href}
      title={`SEO score ${score}/100 — ${label}. Open the product to see what to improve.`}
      aria-label={`SEO score ${score} out of 100, ${label}`}
      className={`inline-flex items-baseline gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold hover:opacity-80 ${TONE[rating]}`}
    >
      {score}
      <span className="font-normal">{label}</span>
    </Link>
  );
}
