import type { Metadata } from 'next';
import Link from 'next/link';
import { CheckCircle2, ClipboardCheck, MessageCircle, Wrench, Home, ShoppingBag, Phone } from 'lucide-react';
import { SUPPORT_PHONE_DISPLAY, SUPPORT_PHONE_TEL, whatsappLink } from '@/lib/contactInfo';

/**
 * Shown after a consultation request is submitted. Its own URL so Google Ads /
 * Meta can count a completed booking as a conversion ("page visit" goal).
 *
 * Never indexed and never in the sitemap: it only makes sense after a submit.
 * Deliberately outside the config-driven PageSeo system, which manages pages we
 * want found (same reasoning as /festive and the staff invite page).
 */
export const metadata: Metadata = {
  title: 'Thank You — Consultation Requested',
  description: 'Your consultation request has been received by the Autobacs India team.',
  robots: { index: false, follow: false, nocache: true },
};

const NEXT_STEPS = [
  {
    icon: ClipboardCheck,
    title: 'We review your request',
    desc: 'A specialist reads your car details and what you are looking for.',
  },
  {
    icon: MessageCircle,
    title: 'We get in touch',
    desc: 'Expect a WhatsApp message or call within one working day (Mon–Sat, 10 AM – 6 PM).',
  },
  {
    icon: Wrench,
    title: 'You get your plan',
    desc: 'Parts, fitment and pricing matched to your vehicle — no obligation to buy.',
  },
];

export default function ConsultationThankYouPage() {
  return (
    <div className="min-h-screen bg-obsidian-deep px-4 py-16 text-ink sm:py-24">
      <div className="mx-auto max-w-3xl">
        <div className="text-center">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full border border-green-500/40 bg-green-500/15">
            <CheckCircle2 className="h-10 w-10 text-green-700" />
          </div>
          <p className="mb-3 font-display text-[11px] uppercase tracking-[0.28em] text-gold">Request received</p>
          <h1 className="mb-4 font-display text-4xl font-light tracking-[-0.01em] md:text-5xl">
            Thank you!
          </h1>
          <p className="mx-auto max-w-xl font-display text-base leading-relaxed text-ink/75 md:text-lg">
            Your consultation request is with our team. We will reach out shortly to talk through your
            build and the best parts for your car.
          </p>
        </div>

        <div className="mt-12 rounded-sm border border-hairline bg-obsidian p-6 sm:p-8">
          <h2 className="mb-6 font-display text-sm font-bold uppercase tracking-widest text-ink/70">What happens next</h2>
          <ol className="grid gap-6 sm:grid-cols-3">
            {NEXT_STEPS.map(({ icon: Icon, title, desc }, i) => (
              <li key={title} className="flex gap-4 sm:flex-col sm:gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm bg-gold/10">
                  <Icon className="h-5 w-5 text-gold" />
                </div>
                <div>
                  <p className="mb-1 font-display text-sm font-bold">
                    <span className="text-gold">{i + 1}.</span> {title}
                  </p>
                  <p className="font-display text-sm leading-relaxed text-ink/65">{desc}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/"
            className="flex w-full items-center justify-center gap-2 rounded-sm bg-gold px-8 py-3.5 font-display text-sm font-bold uppercase tracking-widest text-obsidian transition-opacity hover:opacity-90 sm:w-auto"
          >
            <Home className="h-4 w-4" /> Back to home
          </Link>
          <Link
            href="/products"
            className="flex w-full items-center justify-center gap-2 rounded-sm border border-hairline px-8 py-3.5 font-display text-sm font-bold uppercase tracking-widest text-ink transition-colors hover:border-gold sm:w-auto"
          >
            <ShoppingBag className="h-4 w-4" /> Browse products
          </Link>
        </div>

        <p className="mt-8 text-center font-display text-sm text-ink/60">
          Need us sooner?{' '}
          <a href={`tel:${SUPPORT_PHONE_TEL}`} className="inline-flex items-center gap-1 text-gold hover:underline">
            <Phone className="h-3.5 w-3.5" /> {SUPPORT_PHONE_DISPLAY}
          </a>
          {' '}·{' '}
          <a href={whatsappLink('Hi Autobacs India! I just booked a consultation.')} target="_blank" rel="noopener noreferrer" className="text-gold hover:underline">
            WhatsApp us
          </a>
        </p>
      </div>
    </div>
  );
}
