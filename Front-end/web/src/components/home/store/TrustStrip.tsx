const ITEMS = [
  { title: 'Genuine parts', text: 'Sourced from trusted brands', icon: 'M12 3l7 3v6c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6l7-3zm-3 9l2 2 4-4' },
  { title: 'Fitment support', text: 'Talk to a specialist before you buy', icon: 'M3 14v-3a9 9 0 0 1 18 0v3M21 19a2 2 0 0 1-2 2h-1v-7h3zM3 19a2 2 0 0 0 2 2h1v-7H3z' },
  { title: 'Secure payments', text: 'Razorpay · UPI · Cards · EMI', icon: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4' },
  { title: 'Delivered across India', text: 'Track every order online', icon: 'M3 7h11v9H3zM14 10h4l3 3v3h-7M7 19a1.5 1.5 0 1 0 0-.01M17 19a1.5 1.5 0 1 0 0-.01' },
];

/** Reasons to buy here — each one something the store genuinely does today. */
export default function TrustStrip() {
  return (
    <section className="st-card sh-trust" aria-label="Why shop with us">
      {ITEMS.map((it) => (
        <div className="sh-trust-item" key={it.title}>
          <span className="sh-trust-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={it.icon} /></svg>
          </span>
          <span>
            <span className="sh-trust-title">{it.title}</span>
            <span className="sh-trust-text">{it.text}</span>
          </span>
        </div>
      ))}
    </section>
  );
}
