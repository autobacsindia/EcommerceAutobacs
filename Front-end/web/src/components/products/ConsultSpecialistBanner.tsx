import Link from 'next/link';
import { ArrowRight, Headphones } from 'lucide-react';

interface ConsultSpecialistBannerProps {
  /** Optional product slug — carried to /consultation as attribution (?item=). */
  productSlug?: string;
  className?: string;
}

/**
 * "Consult a specialist" nudge for product pages. High-intent conversion prompt
 * for buyers unsure whether a part fits their build — routes to the consultation
 * booking flow. Deep-link carries lightweight attribution only (the consultation
 * page does not yet consume prefill).
 */
export default function ConsultSpecialistBanner({ productSlug, className = '' }: ConsultSpecialistBannerProps) {
  const href = productSlug
    ? `/consultation?ref=pdp&item=${encodeURIComponent(productSlug)}`
    : '/consultation?ref=pdp';

  return (
    <div
      className={`flex flex-col gap-5 rounded-sm border border-gold/25 bg-gold/[0.04] p-6 sm:flex-row sm:items-center sm:justify-between sm:gap-8 sm:p-8 ${className}`}
    >
      <div className="flex items-start gap-4">
        <Headphones className="mt-0.5 h-6 w-6 shrink-0 text-gold" aria-hidden="true" />
        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-gold">Not sure it fits?</p>
          <h3 className="text-lg font-light text-ink">Consult a specialist about your build</h3>
          <p className="mt-1 max-w-md text-sm font-light text-ink-muted">
            Tell us your vehicle and goals — our team will confirm the right fitment and options before you buy.
          </p>
        </div>
      </div>
      <Link
        href={href}
        className="group inline-flex shrink-0 items-center justify-center gap-2 rounded-sm bg-gold px-6 py-3 text-[11px] font-bold uppercase tracking-[0.18em] text-obsidian transition-opacity hover:opacity-90"
      >
        Consult a specialist
        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
      </Link>
    </div>
  );
}
