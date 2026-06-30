import { brands } from './homeContent';

export default function Brands() {
  // Duplicate the list so the marquee loops seamlessly (translateX -50%).
  const loop = [...brands, ...brands];
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
