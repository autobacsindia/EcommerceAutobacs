import HeroBanners, { type BannerSlide } from './HeroBanners';
import CategoryCards from './CategoryCards';
import ProductRow from './ProductRow';
import BrandStrip from './BrandStrip';
import TrustStrip from './TrustStrip';
import ReviewStrip from './ReviewStrip';
import { discountPct, type StoreHomeData } from './storeData';
import './store.css';

/** Banner slides composed from live catalogue content (see HeroBanners). */
function buildSlides(data: StoreHomeData): BannerSlide[] {
  const slides: BannerSlide[] = [];
  const maxOff = data.deals.reduce((m, p) => Math.max(m, discountPct(p)), 0);
  if (data.deals.length >= 3 && maxOff > 0) {
    slides.push({
      id: 'deals',
      eyebrow: "Today's Deals",
      title: `Up to ${maxOff}% off on top upgrades`,
      subtitle: `${data.dealsTotal} products on sale now — suspension, body kits, lighting and more.`,
      cta: 'Shop the deals',
      href: '/offers',
      images: data.deals.slice(0, 3).map((p) => p.image),
      tone: 'green',
    });
  }
  const fitImages = (data.bestSellers.length >= 3 ? data.bestSellers : data.newArrivals).slice(0, 3).map((p) => p.image);
  slides.push({
    id: 'vehicle',
    eyebrow: 'Shop by vehicle',
    title: 'Parts that fit your car',
    subtitle: 'Choose your make and model — see only the upgrades that fit it.',
    cta: 'Find my parts',
    href: '/vehicles',
    images: fitImages,
    tone: 'mint',
  });
  if (data.newArrivals.length >= 3) {
    slides.push({
      id: 'new',
      eyebrow: 'Just landed',
      title: 'New arrivals this week',
      subtitle: 'Fresh additions to the catalogue, from brands you trust.',
      cta: 'See what’s new',
      href: '/products',
      images: data.newArrivals.slice(0, 3).map((p) => p.image),
      tone: 'sand',
    });
  }
  return slides;
}

/**
 * The light, Amazon-style store home page: dark header (for the white logo), green
 * category bar, offers carousel with overlapping category cards, then product
 * shelves — every one from live data, empty shelves skipped.
 */
export default function StoreHome({ data }: { data: StoreHomeData }) {
  // The header, the admin promo strip and the footer come from the root layout
  // (ConditionalHeader / ConditionalPromoBanner / ConditionalFooter), exactly as on
  // every other page. The home page used to render its own copies and rely on
  // the layout hiding its versions on '/'; on Vercel the ISR-regenerated home
  // page rendered BOTH, so customers saw two headers and two footers.
  return (
    <div className="sh sh-theme">
      <main className="sh-main">
        {/* The page's one H1, for search engines and screen readers; the banner
            titles below are the visible headlines. */}
        <h1 className="sh-sr-only">Roavion by Autobacs India — car parts, accessories and upgrades online</h1>
        <HeroBanners slides={buildSlides(data)} />
        <div className="sh-content">
          <CategoryCards categories={data.categories} deals={data.deals} />
          <ProductRow
            id="sh-deals"
            title="Today's Deals"
            subtitle="Real savings on genuine parts — M.R.P. shown on every deal"
            href="/offers"
            products={data.deals}
          />
          <ProductRow
            id="sh-best"
            title="Best Sellers"
            subtitle="Most bought by our customers"
            href="/products?sort=sales_desc"
            products={data.bestSellers}
            rankBadges={3}
          />
          <TrustStrip />
          {data.categoryRows.map((row) => (
            <ProductRow
              key={row.category.slug}
              id={`sh-cat-${row.category.slug}`}
              title={`Top in ${row.category.name}`}
              href={row.category.href}
              products={row.products}
            />
          ))}
          <ProductRow
            id="sh-new"
            title="New Arrivals"
            subtitle="Fresh additions to the catalogue"
            href="/products"
            products={data.newArrivals}
          />
          <BrandStrip brands={data.brands} />
          <ReviewStrip reviews={data.reviews} />
        </div>
      </main>
    </div>
  );
}
