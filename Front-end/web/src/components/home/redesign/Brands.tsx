import { brands as fallbackBrands } from './homeContent';

export default function Brands({ brands }: { brands?: string[] }) {
  // Live brand names from the DB; static placeholders if none resolved.
  const items = brands?.length ? brands : fallbackBrands;
  // Duplicate the list so the marquee loops seamlessly (translateX -50%).
  const loop = [...items, ...items];
  return (
    <section className="brands">
      <div className="brands-label">Trusted Brands</div>
      <div className="marquee-mask">
        <div className="marquee-track">
          {loop.map((b, i) => (
            <span className="brand-item" key={`${b}-${i}`}>
              {b}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
