import Link from 'next/link';
import Img from '../redesign/Img';
import type { StoreCategory, StoreProduct } from './storeData';
import ShopByVehicleCard from './ShopByVehicleCard';

type Tile = { label: string; href: string; image: string };

function QuadCard({ title, tiles, more }: { title: string; tiles: Tile[]; more: { label: string; href: string } }) {
  return (
    <div className="st-card sh-quad">
      <h2 className="st-h3">{title}</h2>
      <div className="sh-quad-grid">
        {tiles.slice(0, 4).map((t) => (
          <Link key={t.href + t.label} href={t.href} className="sh-quad-tile">
            <span className="sh-quad-media"><Img src={t.image} alt="" className="sh-quad-img" sizes="(max-width: 768px) 40vw, 140px" /></span>
            <span className="sh-quad-label">{t.label}</span>
          </Link>
        ))}
      </div>
      <Link href={more.href} className="st-link">{more.label}</Link>
    </div>
  );
}

/**
 * Amazon's signature 4-up cards that overlap the bottom of the banner: two cards of
 * categories, one of top deals, one to shop by vehicle. All from live data.
 */
export default function CategoryCards({ categories, deals }: { categories: StoreCategory[]; deals: StoreProduct[] }) {
  const withImg = categories.filter((c) => c.image);
  const cats = (withImg.length >= 8 ? withImg : categories).map((c) => ({ label: c.name, href: c.href, image: c.image }));
  const dealTiles = deals.slice(0, 4).map((d) => ({ label: d.name, href: d.href, image: d.image }));

  return (
    <div className="sh-quads">
      {cats.length >= 4 && <QuadCard title="Shop by category" tiles={cats.slice(0, 4)} more={{ label: 'See all categories', href: '/categories' }} />}
      {cats.length >= 8 && <QuadCard title="Upgrade your ride" tiles={cats.slice(4, 8)} more={{ label: 'Explore more', href: '/categories' }} />}
      {dealTiles.length >= 4 && <QuadCard title="Top deals for you" tiles={dealTiles} more={{ label: "See all deals", href: '/offers' }} />}
      <ShopByVehicleCard />
    </div>
  );
}
