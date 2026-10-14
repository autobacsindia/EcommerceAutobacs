import HeroBanners, { type BannerSlide } from './HeroBanners';
import CategoryCards from './CategoryCards';
import ProductRow from './ProductRow';
import BrandStrip from './BrandStrip';
import TrustStrip from './TrustStrip';
import ReviewStrip from './ReviewStrip';
import { discountPct, type StoreHomeData, type StoreProduct } from './storeData';
import './store.css';

/**
 * Banner slides, composed from live catalogue content (see HeroBanners).
 *
 * Each slide's three photographs come from `pickPhotos`: the admin's featured
 * products first, then the slide's own ranked list. See `storeData.featured`
 * for why — in short, the ranking that is factually correct ("the biggest
 * discount") is not the same as the one that sells, and only a person can tell
 * the difference.
 */
export function buildSlides(data: StoreHomeData): BannerSlide[] {
  const slides: BannerSlide[] = [];

  /**
   * Three images for a banner: the admin's featured picks first, topped up from
   * the banner's own list, de-duplicated so one photo never appears twice.
   *
   * `onlyFrom` restricts the featured picks to products that are already in
   * that list. The deals banner needs it: a banner headlined "Up to 58% off"
   * must never illustrate itself with a product that carries no discount,
   * however good the photograph is. Ticking Featured promotes a product WITHIN
   * a banner; it does not smuggle it into one it does not belong in.
   */
  /*
    Featured products are handed out ACROSS the banners, not repeated on each.

    The first version gave every banner `data.featured` from the top, so with
    three or more ticked, all three banners showed the same three photographs —
    a carousel that appears not to move. `used` is shared across the calls, so
    a product promoted onto one banner is not offered to the next.
  */
  const used = new Set<string>();

  const pickPhotos = (pool: StoreProduct[], onlyFrom = false) => {
    const eligible = onlyFrom
      ? data.featured.filter((f) => pool.some((p) => p.id === f.id))
      : data.featured;

    const chosen: StoreProduct[] = [];
    const take = (p: StoreProduct) => {
      if (chosen.length >= 3) return;
      if (chosen.some((c) => c.id === p.id)) return;
      chosen.push(p);
      used.add(p.id);
    };

    // Featured picks this banner has not already spent elsewhere.
    for (const p of eligible) if (!used.has(p.id)) take(p);
    // Then the banner's own list, still skipping anything already on screen.
    for (const p of pool) if (!used.has(p.id)) take(p);
    /*
      Last resort: if everything in this banner's pool is already shown
      elsewhere, repeat rather than render a short or empty banner. A banner
      with two photos where the layout expects three looks broken; a repeated
      photo merely looks unlucky, and only happens on a very small catalogue.
    */
    for (const p of pool) take(p);

    return chosen.slice(0, 3).map((p) => ({ src: p.image, href: p.href, name: p.name }));
  };

  const maxOff = data.deals.reduce((m, p) => Math.max(m, discountPct(p)), 0);
  if (data.deals.length >= 3 && maxOff > 0) {
    slides.push({
      id: 'deals',
      eyebrow: "Today's Deals",
      title: `Up to ${maxOff}% off on top upgrades`,
      subtitle: `${data.dealsTotal} products on sale now — suspension, body kits, lighting and more.`,
      cta: 'Shop the deals',
      href: '/offers',
      images: pickPhotos(data.deals, true),
      tone: 'green',
    });
  }

  slides.push({
    id: 'vehicle',
    eyebrow: 'Shop by vehicle',
    title: 'Parts that fit your car',
    subtitle: 'Choose your make and model — see only the upgrades that fit it.',
    cta: 'Find my parts',
    href: '/vehicles',
    images: pickPhotos(data.bestSellers.length >= 3 ? data.bestSellers : data.newArrivals),
    tone: 'mint',
  });

  if (data.newArrivals.length >= 3) {
    slides.push({
      id: 'new',
      eyebrow: 'Just landed',
      title: 'New arrivals this week',
      subtitle: 'Fresh additions to the catalogue, from brands you trust.',
      cta: 'See what\u2019s new',
      href: '/products',
      images: pickPhotos(data.newArrivals),
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
