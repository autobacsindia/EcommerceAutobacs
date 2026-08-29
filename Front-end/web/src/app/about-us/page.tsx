import type { Metadata } from 'next';
import { Bebas_Neue } from 'next/font/google';
import Image from 'next/image';
import Link from 'next/link';
import {
  Building2,
  FileCheck2,
  Handshake,
  Headphones,
  MapPin,
  ShoppingBag,
  Wrench,
  X,
} from 'lucide-react';

import Eyebrow from '@/components/ui/Eyebrow';
import Reveal from '@/components/ui/Reveal';
import StoreButton from '@/components/ui/StoreButton';
import { buildPageMetadata } from '@/lib/pageSeo';

import StatCounters, { type Stat } from './StatCounters';
import './about.css';

// Self-hosted via next/font (CSP blocks fonts.gstatic.com). Exposed as the
// --font-bebas variable that .about-display reads — same face and treatment as
// the careers hero.
const bebas = Bebas_Neue({
  variable: '--font-bebas',
  subsets: ['latin'],
  weight: '400',
  display: 'swap',
});

// Admin-managed SEO (/admin/seo) with the copy deck's positioning as the
// fallback. The page is a server component now, so metadata lives here rather
// than in a wrapper layout.
export const generateMetadata = (): Promise<Metadata> =>
  buildPageMetadata('/about-us', {
    title: 'About Us',
    description:
      'We didn’t enter the Indian automotive aftermarket — we built it. Premium parts, custom builds, dealer supply and 42 fitment points across India, since 2015.',
  });

const HERO_IMAGE =
  'https://res.cloudinary.com/dhwxtl6l8/image/upload/f_auto,q_auto,c_limit,w_1920/autobacs/site/hero-performance-vehicle.jpg';

const whatWeDo = [
  {
    icon: ShoppingBag,
    title: 'E-commerce',
    body: 'A full catalogue of international brands, shipped across India.',
    href: '/products',
  },
  {
    icon: Wrench,
    title: 'Custom builds',
    body: 'Complete off-road, overland and performance vehicle projects.',
    href: '/consultation',
  },
  {
    icon: Handshake,
    title: 'Dealer network',
    body: 'Supply and support for partners nationwide.',
    href: '/contact?subject=Dealer%20network%20enquiry',
  },
  {
    icon: MapPin,
    title: 'Installation points',
    body: '42 collaborated fitment centres across the country.',
  },
  {
    icon: Building2,
    title: 'B2B & showroom supply',
    body: 'Accessory and upgrade programmes for car dealerships.',
    href: '/contact?subject=B2B%20%26%20showroom%20supply%20enquiry',
  },
  {
    icon: FileCheck2,
    title: 'Government tenders',
    body: 'Specialist and duty-specific vehicle builds.',
    href: '/contact?subject=Government%20tender%20enquiry',
  },
  {
    icon: Headphones,
    title: 'Direct sales',
    body: 'A dedicated team for consultation, specification and order management.',
    href: '/consultation',
  },
];

const stats: Stat[] = [
  { value: 10000, suffix: '+', label: 'Customers served' },
  { value: 1200, suffix: '+', label: 'Vehicle builds completed' },
  { value: 10000, suffix: '+', label: 'Orders shipped' },
  { value: 42, label: 'Installation points across India' },
  { value: 200, suffix: '+', label: 'People across India, Bangkok & China' },
  { value: 11, suffix: ' yrs', label: 'In the market' },
];

const whyAutobacs = [
  {
    title: 'A real company',
    body: 'Registered, structured, with functioning departments — sales, purchase, operations, marketing, support and finance. Not a workshop with a phone number.',
  },
  {
    title: 'A real supply chain',
    body: 'Our own sourcing teams in Bangkok and China, a warehouse in Alipur, North India, and direct relationships with international brands. We import ourselves. Nothing passes through three middlemen before it reaches you.',
  },
  {
    title: 'A real platform',
    body: 'A professional e-commerce operation with proper cataloguing, order tracking and dispatch — not DMs and screenshots.',
  },
  {
    title: 'Real support',
    body: 'Documented orders, a support team you can reach, and people who are still there after the sale.',
  },
  {
    title: 'Real expertise',
    body: 'A decade of builds behind every recommendation. We know what fits, what lasts, and what fails — because we’ve fitted it.',
  },
];

const wontDo = [
  'We don’t sell counterfeit or replica parts',
  'We don’t fit components that compromise vehicle safety or structural integrity',
  'We don’t sell products we haven’t tested or can’t support',
  'We don’t take on builds we can’t execute properly',
  'We don’t chase the lowest price at the cost of the customer',
];

const locations = [
  { label: 'Head office', value: 'Kochi, Kerala — corporate team of 20' },
  { label: 'Warehouse', value: 'Alipur, North India' },
  { label: 'Sourcing & export teams', value: 'Bangkok and China' },
  { label: 'Fitment', value: '42 collaborated installation points nationwide' },
];

const closingCtas = [
  {
    title: 'Shop the store',
    body: 'Browse the full catalogue of international aftermarket brands.',
    cta: 'Shop now',
    href: '/products',
    variant: 'gold' as const,
  },
  {
    title: 'Build your vehicle',
    body: 'Talk to our team about a custom project, from suspension to full off-road spec.',
    cta: 'Book a consultation',
    href: '/consultation',
    variant: 'ghost' as const,
  },
  {
    title: 'Become a partner',
    body: 'Join our dealer and installation network across India.',
    cta: 'Partner with us',
    href: '/contact?subject=Dealer%20%26%20installation%20partnership',
    variant: 'line' as const,
  },
  {
    title: 'B2B & showroom supply',
    body: 'Accessory and upgrade programmes for dealerships and fleets.',
    cta: 'Enquire',
    href: '/contact?subject=B2B%20%26%20showroom%20supply%20enquiry',
    variant: 'line' as const,
  },
  {
    title: 'Get in touch',
    body: 'Questions, orders, anything else.',
    cta: 'Contact us',
    href: '/contact',
    variant: 'line' as const,
  },
];

const sectionHeading = 'about-display text-[clamp(2.25rem,5vw,4rem)] text-ink';
const body = 'text-ink/70 font-display leading-relaxed';

export default function AboutUsPage() {
  return (
    <div className={`${bebas.variable} min-h-screen bg-obsidian-deep`}>
      {/* ── Hero ───────────────────────────────────────────────────────── */}
      <section className="relative bg-obsidian-deep">
        <div className="absolute inset-0">
          <Image
            src={HERO_IMAGE}
            alt=""
            aria-hidden
            fill
            priority
            sizes="100vw"
            className="object-cover opacity-25"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-obsidian-deep/60 via-obsidian-deep/70 to-obsidian-deep" />
        </div>
        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-28 md:py-36">
          <Eyebrow className="mb-4">About Autobacs India</Eyebrow>
          <h1 className="about-display text-[clamp(3rem,8.5vw,7.5rem)] text-ink mb-8">
            We didn’t enter the Indian aftermarket.
            <br />
            <span className="text-gold">We built it.</span>
          </h1>
          <p className={`${body} text-lg md:text-xl max-w-3xl`}>
            Eleven years ago, most of the products on this site were nearly impossible to buy in
            India. Not because there was no demand — because nobody knew they existed. We spent
            more than a decade changing that.
          </p>
        </div>
      </section>

      {/* ── 1. Where it started ────────────────────────────────────────── */}
      <section className="py-20 bg-obsidian border-y border-hairline">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal>
            <Eyebrow className="mb-3">Where it started</Eyebrow>
            <h2 className={`${sectionHeading} mb-12`}>The market that didn’t exist yet</h2>
          </Reveal>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
            <Reveal>
              <article className="h-full border-l border-hairline pl-6 md:pl-8">
                <p className="font-display text-gold text-sm uppercase tracking-[0.22em] mb-4">
                  2015 · Bangkok
                </p>
                <p className={`${body} mb-4`}>
                  It began as a small trade business, born out of one observation: Thailand and
                  Malaysia had a billion-dollar automotive aftermarket that was growing fast, and
                  India — a far bigger market — had almost nothing.
                </p>
                <p className={body}>
                  The vehicles were the same. The owners were the same. The only thing missing was
                  access, and the knowledge that any of it was possible.
                </p>
              </article>
            </Reveal>

            <Reveal delay={0.08}>
              <article className="h-full border-l border-hairline pl-6 md:pl-8">
                <p className="font-display text-gold text-sm uppercase tracking-[0.22em] mb-4">
                  2016 · Kollam, Kerala
                </p>
                <p className={body}>
                  We opened a garage. One workshop, a handful of imported parts, custom FRP
                  manufactured bodykits and a lot of explaining. Every customer conversation
                  started from zero — what these products were, why they mattered, and why a
                  factory vehicle was only the starting point.
                </p>
              </article>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── 2. The build that changed everything ───────────────────────── */}
      <section className="py-20 bg-obsidian-deep">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal>
            <Eyebrow className="mb-3">2017 · The build that changed everything</Eyebrow>
            <h2 className={`${sectionHeading} mb-8`}>A ₹20 lakh bet on a Ford Endeavour</h2>
            <p className={`${body} mb-4`}>
              We bought a brand-new Ford Endeavour and put ₹20 lakh into building it the way it was
              being done in Thailand and Australia. At the time, that was an enormous bet for a
              workshop our size.
            </p>
            <p className={`${body} mb-10`}>
              It went viral across the country. News18 ran a feature on it. Suddenly people weren’t
              asking <em>what</em> these products were — they were asking where to get them.{' '}
              <Link href="/media" className="text-gold underline underline-offset-4 hover:text-ink transition-colors">
                See the coverage
              </Link>
              .
            </p>
          </Reveal>

          <Reveal delay={0.08}>
            <blockquote className="border-l-2 border-gold pl-6 md:pl-8">
              <p className="font-display text-xl md:text-2xl font-light text-ink tracking-[-0.01em] leading-snug">
                That build is the reason a large part of this industry now exists in India.
              </p>
            </blockquote>
          </Reveal>
        </div>
      </section>

      {/* ── 3. The rebuild ─────────────────────────────────────────────── */}
      <section className="py-20 bg-obsidian border-y border-hairline">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal>
            <Eyebrow className="mb-3">2022 · The rebuild</Eyebrow>
            <h2 className={`${sectionHeading} mb-8`}>
              We walked away from guaranteed income to build something that could scale
            </h2>
            <p className={`${body} mb-4`}>
              After Covid, the market changed completely — and we made the hardest decision in the
              company’s history. We shut down our revenue-generating garage model, took an office in
              Kochi, hired an entirely new team, and rebuilt Autobacs as a proper corporate business
              with real departments, real systems, and a full e-commerce platform.
            </p>
            <p className={body}>
              Everything you see today — the website, the sales team, the dealer network, the
              nationwide installation points — came out of that decision.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ── 4. What we do ──────────────────────────────────────────────── */}
      <section className="py-20 bg-obsidian-deep">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal>
            <Eyebrow className="mb-3">What we do</Eyebrow>
            <h2 className={`${sectionHeading} mb-4`}>Across the full chain</h2>
            <p className={`${body} max-w-3xl mb-12`}>
              We are a premium automotive aftermarket company operating across the full chain —
              sourcing, importing, retail, distribution, fitment and custom fabrication.
            </p>
          </Reveal>

          <div
            data-testid="about-what-we-do"
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
          >
            {whatWeDo.map((item, i) => {
              const Icon = item.icon;
              const card = (
                <div className="h-full bg-obsidian border border-hairline rounded-sm p-7 transition-colors hover:border-gold">
                  <Icon className="h-6 w-6 text-gold mb-5" aria-hidden />
                  <h3 className="font-display font-light text-ink tracking-[-0.01em] mb-2">
                    {item.title}
                  </h3>
                  <p className={`${body} text-sm`}>{item.body}</p>
                </div>
              );

              return (
                <Reveal key={item.title} delay={i * 0.05} className="h-full">
                  {item.href ? (
                    <Link href={item.href} className="block h-full">
                      {card}
                    </Link>
                  ) : (
                    card
                  )}
                </Reveal>
              );
            })}
          </div>

          <Reveal delay={0.1}>
            <div className="mt-12">
              <StoreButton href="/consultation">Talk to a build consultant</StoreButton>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── 5. By the numbers ──────────────────────────────────────────── */}
      <section className="py-20 bg-obsidian border-y border-hairline">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal>
            <div className="text-center mb-14">
              <Eyebrow className="mb-3">By the numbers</Eyebrow>
              <h2 className={sectionHeading}>Eleven years, counted</h2>
            </div>
          </Reveal>

          <StatCounters stats={stats} />

          <p className={`${body} text-sm text-center mt-12`}>
            Coverage across effectively every major city in India.
          </p>
        </div>
      </section>

      {/* ── 6. Why Autobacs ────────────────────────────────────────────── */}
      <section className="py-20 bg-obsidian-deep">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal>
            <Eyebrow className="mb-3">Why Autobacs</Eyebrow>
            <h2 className={`${sectionHeading} mb-4`}>Built differently, on purpose</h2>
            <p className={`${body} max-w-3xl mb-12`}>
              Most of this industry is still unorganised — unregistered operators, one-man setups,
              and shops with no accountability once your money has changed hands.
            </p>
          </Reveal>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {whyAutobacs.map((item, i) => (
              <Reveal key={item.title} delay={i * 0.05} className="h-full">
                <div className="h-full bg-obsidian-raised border border-hairline rounded-sm p-7">
                  <h3 className="font-display font-light text-gold tracking-[-0.01em] mb-3">
                    {item.title}
                  </h3>
                  <p className={`${body} text-sm`}>{item.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── 7. Signature builds ────────────────────────────────────────── */}
      <section className="py-20 bg-obsidian border-y border-hairline">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal>
            <Eyebrow className="mb-3">Signature builds</Eyebrow>
            <h2 className={`${sectionHeading} mb-8`}>1,200+ vehicle projects</h2>
            <p className={`${body} mb-4`}>
              We’ve completed over 1,200 vehicle projects, from daily-driven upgrades to full
              mission-specification builds.
            </p>
            <p className={`${body} mb-10`}>
              Among them: a <strong className="text-ink font-normal">₹52 lakh Special Operations
              vehicle</strong> built for helicopter support duty in Dehradun — engineered to
              specification, built to survive the job.
            </p>
            <StoreButton href="/media" variant="ghost">
              See our work
            </StoreButton>
          </Reveal>
        </div>
      </section>

      {/* ── 8. What we won't do ────────────────────────────────────────── */}
      <section className="py-20 bg-obsidian-deep">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal>
            <Eyebrow className="mb-3">What we won’t do</Eyebrow>
            <h2 className={`${sectionHeading} mb-10`}>
              Being the biggest option isn’t the goal. Being the one you can trust is.
            </h2>
          </Reveal>

          <ul className="space-y-4 mb-10">
            {wontDo.map((line, i) => (
              <Reveal key={line} delay={i * 0.05}>
                <li className="flex items-start gap-4">
                  <X className="h-4 w-4 text-gold shrink-0 mt-1.5" aria-hidden />
                  <span className={body}>{line}</span>
                </li>
              </Reveal>
            ))}
          </ul>

          <Reveal>
            <p className="font-display text-lg font-light text-ink tracking-[-0.01em]">
              If a job shouldn’t be done, we’ll tell you — even when it costs us the sale.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ── 9. Where we are ────────────────────────────────────────────── */}
      <section className="py-20 bg-obsidian border-y border-hairline">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal>
            <Eyebrow className="mb-3">Where we are</Eyebrow>
            <h2 className={`${sectionHeading} mb-12`}>Kochi to Bangkok</h2>
          </Reveal>

          <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {locations.map((loc, i) => (
              <Reveal key={loc.label} delay={i * 0.05}>
                <div className="border-t border-hairline pt-5">
                  <dt className="font-display text-[10px] uppercase tracking-[0.22em] text-gold mb-2">
                    {loc.label}
                  </dt>
                  <dd className={`${body} text-sm`}>{loc.value}</dd>
                </div>
              </Reveal>
            ))}
          </dl>

          <Reveal delay={0.1}>
            <div className="mt-12 flex flex-col sm:flex-row gap-6 sm:items-center">
              <a
                href="tel:+919895257905"
                className="font-display text-xl text-gold hover:text-ink transition-colors"
              >
                +91 98952 57905
              </a>
              <a
                href="tel:+919895502139"
                className="font-display text-xl text-gold hover:text-ink transition-colors"
              >
                +91 98955 02139
              </a>
              <p className={`${body} text-sm`}>Monday to Saturday, 10:00 AM – 6:00 PM IST.</p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── 10. Calls to action ────────────────────────────────────────── */}
      <section className="py-20 bg-obsidian-deep">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal>
            <Eyebrow className="mb-3">Next step</Eyebrow>
            <h2 className={`${sectionHeading} mb-12`}>Where would you like to start?</h2>
          </Reveal>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {closingCtas.map((item, i) => (
              <Reveal key={item.title} delay={i * 0.05} className="h-full">
                <div className="h-full flex flex-col bg-obsidian border border-hairline rounded-sm p-7">
                  <h3 className="font-display font-light text-ink tracking-[-0.01em] mb-2">
                    {item.title}
                  </h3>
                  <p className={`${body} text-sm mb-6`}>{item.body}</p>
                  <div className="mt-auto">
                    <StoreButton href={item.href} variant={item.variant}>
                      {item.cta}
                    </StoreButton>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>

          <Reveal delay={0.1}>
            <p className={`${body} text-sm mt-12`}>
              The brands we carry are listed on the{' '}
              <Link href="/brands" className="text-gold underline underline-offset-4 hover:text-ink transition-colors">
                brands page
              </Link>
              , and press coverage lives on the{' '}
              <Link href="/media" className="text-gold underline underline-offset-4 hover:text-ink transition-colors">
                media page
              </Link>
              .
            </p>
          </Reveal>
        </div>
      </section>
    </div>
  );
}
