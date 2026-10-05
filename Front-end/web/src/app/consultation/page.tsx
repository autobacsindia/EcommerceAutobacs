'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import {
  Zap, Wrench, Star, HeadphonesIcon, Phone, Loader2, AlertCircle, ArrowRight, Check,
} from 'lucide-react';
import apiClient from '@/lib/api';
import { capture } from '@/lib/analytics';
import { SUPPORT_PHONE_DISPLAY, SUPPORT_PHONE_TEL, whatsappLink } from '@/lib/contactInfo';

/**
 * Book a consultation — one short form, right in the hero.
 *
 * The page used to be a six-step "build profile" wizard behind a hero button;
 * most visitors left before the last step. It now asks only what the team needs
 * to call back: who you are, how to reach you, your car and what you want.
 * The API still requires city and car (it seeds the Sales CRM lead), so those
 * stay; everything else it accepts is optional and is no longer asked.
 *
 * On success the visitor goes to /consultation/thank-you — a real URL, so ad
 * platforms can count completed bookings as a conversion.
 */

interface FormState {
  name: string;
  whatsapp: string;
  email: string;
  city: string;
  makeModel: string;
  notes: string;
}

const EMPTY: FormState = { name: '', whatsapp: '', email: '', city: '', makeModel: '', notes: '' };

const TRUST_ITEMS = [
  { icon: Zap,            title: 'Performance-Focused Plans',  desc: 'Every upgrade mapped to your driving goals, not just catalogue picks.' },
  { icon: Wrench,         title: 'Precision Fitment',          desc: 'Body kits, exhausts and suspension tested for your exact make & model.' },
  { icon: Star,           title: 'Premium Products Only',      desc: 'Curated catalogue from global brands — zero compromise on quality.' },
  { icon: HeadphonesIcon, title: 'End-to-End Support',         desc: 'From spec sheet to road test, our team guides every step.' },
];

const HERO_POINTS = [
  'A plan built for your exact vehicle',
  'Genuine parts, fitted right the first time',
  'A specialist calls you back — no obligation',
];

function validateWhatsApp(value: string): string {
  const digits = value.replace(/[\s\-().+]/g, '');
  const bare = digits.startsWith('91') && digits.length === 12 ? digits.slice(2) : digits;
  return /^[6-9]\d{9}$/.test(bare) ? '' : 'Enter a valid 10-digit Indian mobile number (starts with 6–9).';
}

function validateEmail(value: string): string {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? '' : 'Enter a valid email address (e.g. you@example.com).';
}

/** Readable product name from a product-page link (?product=Name or ?item=slug). */
function enquiryFromUrl(): string {
  const params = new URLSearchParams(window.location.search);
  const product = params.get('product');
  if (product) return product;
  const item = params.get('item');
  return item ? item.replace(/-/g, ' ') : '';
}

const inputClass = 'w-full bg-black/40 border border-white/15 text-ink placeholder:text-ink-muted rounded-sm px-4 py-3 focus:outline-none focus:border-gold focus:ring-2 focus:ring-gold/25 font-display text-sm transition-colors';
const labelClass = 'block text-xs font-display font-bold text-ink-muted uppercase tracking-widest mb-1.5';

export default function ConsultationPage() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>({ ...EMPTY });
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Prefill from a product enquiry link. Read on mount from the URL rather than
  // useSearchParams, which would force a Suspense boundary around the page.
  useEffect(() => {
    const product = enquiryFromUrl();
    if (product) setForm((prev) => (prev.notes ? prev : { ...prev, notes: `Enquiry about: ${product}` }));
  }, []);

  const set = (key: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  function validate(): boolean {
    const next: Partial<Record<keyof FormState, string>> = {};
    if (form.name.trim().length < 2) next.name = 'Please enter your name.';
    const wa = validateWhatsApp(form.whatsapp);
    if (wa) next.whatsapp = wa;
    const em = validateEmail(form.email);
    if (em) next.email = em;
    if (!form.city.trim()) next.city = 'Please enter your city.';
    if (!form.makeModel.trim()) next.makeModel = 'Please enter your car make and model.';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!validate()) return;
    setSubmitting(true);
    try {
      const data = await apiClient.post<{ success: boolean; message?: string }>('/consultation', {
        name: form.name.trim(),
        whatsapp: form.whatsapp.trim(),
        email: form.email.trim(),
        city: form.city.trim(),
        makeModel: form.makeModel.trim(),
        notes: form.notes.trim(),
        // The short form doesn't ask; record that honestly instead of the API's
        // "In-Person" default, so the team knows to agree it on the call.
        mode: 'To be discussed',
      });
      if (!data.success) throw new Error(data.message || 'Submission failed');
      capture('consultation_submitted', { hasNotes: !!form.notes.trim() });
      router.push('/consultation/thank-you');
    } catch (err: unknown) {
      const msg = (err as { rawData?: { message?: string } })?.rawData?.message
        || (err instanceof Error ? err.message : '');
      setError(msg || 'Something went wrong. Please try again, or message us on WhatsApp.');
      setSubmitting(false);
    }
  }

  const field = (key: keyof FormState) => `${inputClass} ${errors[key] ? 'border-red-500 focus:border-red-400' : ''}`;
  const fieldError = (key: keyof FormState) =>
    errors[key] ? <p className="mt-1 text-xs text-red-400 font-display">{errors[key]}</p> : null;

  return (
    <div className="bg-obsidian-deep min-h-screen text-ink">
      {/* Hero: pitch on the left, the form on the right */}
      <section className="relative overflow-hidden">
        <Image
          src="https://images.unsplash.com/photo-1544636331-e26879cd4d9b?auto=format&fit=crop&w=1400&q=60&fm=webp"
          alt="Performance car workshop"
          fill
          priority
          sizes="100vw"
          className="object-cover"
        />
        <div className="absolute inset-0 bg-linear-to-br from-black/90 via-black/75 to-gold/30" />
        <div className="absolute inset-0 bg-linear-to-t from-obsidian-deep via-transparent to-transparent" />

        <div className="relative z-10 mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 sm:px-6 md:py-20 lg:grid-cols-2 lg:gap-16 lg:px-8">
          <div>
            <p className="mb-4 font-display text-[11px] uppercase tracking-[0.28em] text-gold">Free expert consultation</p>
            <h1 className="mb-5 font-display text-4xl font-light leading-[1.05] tracking-[-0.01em] md:text-6xl">
              Build it right.
              <span className="block text-gold italic">Drive it better.</span>
            </h1>
            <blockquote className="mb-6 border-l-2 border-gold/60 pl-4 font-display text-base leading-relaxed text-ink/80 md:text-lg">
              Tell us about your car and what you want from it. A specialist will come back with a plan
              built for your vehicle, your driving and your budget.
            </blockquote>
            <ul className="mb-8 space-y-2.5">
              {HERO_POINTS.map((point) => (
                <li key={point} className="flex items-center gap-3 font-display text-sm text-ink/80">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gold/15">
                    <Check className="h-3 w-3 text-gold" />
                  </span>
                  {point}
                </li>
              ))}
            </ul>
            <p className="font-display text-sm text-ink/60">
              Prefer to talk now?{' '}
              <a href={`tel:${SUPPORT_PHONE_TEL}`} className="text-gold hover:underline">Call {SUPPORT_PHONE_DISPLAY}</a>
              {' '}or{' '}
              <a href={whatsappLink('Hi Autobacs India! I would like a consultation.')} target="_blank" rel="noopener noreferrer" className="text-gold hover:underline">
                message us on WhatsApp
              </a>.
            </p>
          </div>

          <form
            id="consultation-form"
            onSubmit={submit}
            noValidate
            className="relative overflow-hidden rounded-md border border-gold/45 bg-[#141414]/95 p-6 shadow-[0_0_0_1px_rgba(201,168,112,0.08),0_30px_80px_-20px_rgba(0,0,0,0.9),0_0_70px_-10px_rgba(201,168,112,0.28)] backdrop-blur sm:p-8"
          >
            {/* Gold accent strip — draws the eye to the form against the photo. */}
            <div aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-linear-to-r from-gold/40 via-gold to-gold/40" />
            <span className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-gold/40 bg-gold/10 px-3 py-1 font-display text-[10px] font-bold uppercase tracking-[0.2em] text-gold">
              <Check className="h-3 w-3" /> Free · No obligation
            </span>
            <h2 className="mb-1 font-display text-3xl font-light tracking-[-0.01em]">Book your consultation</h2>
            <p className="mb-6 font-display text-sm text-ink/65">Takes less than a minute — a specialist replies within one working day.</p>

            <div className="space-y-4">
              <div>
                <label htmlFor="c-name" className={labelClass}>Full name <span className="text-gold">*</span></label>
                <input id="c-name" autoComplete="name" value={form.name} onChange={(e) => set('name', e.target.value)}
                  placeholder="e.g. Rahul Sharma" maxLength={100} className={field('name')} />
                {fieldError('name')}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="c-wa" className={labelClass}>WhatsApp number <span className="text-gold">*</span></label>
                  <input id="c-wa" type="tel" inputMode="tel" autoComplete="tel" value={form.whatsapp}
                    onChange={(e) => set('whatsapp', e.target.value)} placeholder="98765 43210" maxLength={16} className={field('whatsapp')} />
                  {fieldError('whatsapp')}
                </div>
                <div>
                  <label htmlFor="c-email" className={labelClass}>Email <span className="text-gold">*</span></label>
                  <input id="c-email" type="email" autoComplete="email" value={form.email}
                    onChange={(e) => set('email', e.target.value)} placeholder="you@example.com" maxLength={254} className={field('email')} />
                  {fieldError('email')}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="c-city" className={labelClass}>City <span className="text-gold">*</span></label>
                  <input id="c-city" autoComplete="address-level2" value={form.city}
                    onChange={(e) => set('city', e.target.value)} placeholder="e.g. Kochi" maxLength={80} className={field('city')} />
                  {fieldError('city')}
                </div>
                <div>
                  <label htmlFor="c-car" className={labelClass}>Car (make &amp; model) <span className="text-gold">*</span></label>
                  <input id="c-car" value={form.makeModel}
                    onChange={(e) => set('makeModel', e.target.value)} placeholder="e.g. Toyota Hilux" maxLength={100} className={field('makeModel')} />
                  {fieldError('makeModel')}
                </div>
              </div>

              <div>
                <label htmlFor="c-notes" className={labelClass}>What are you looking for?</label>
                <textarea id="c-notes" rows={4} value={form.notes} onChange={(e) => set('notes', e.target.value)}
                  placeholder="e.g. Lift kit and LED lights for off-road trips, budget around ₹1.5 lakh"
                  maxLength={2000} className={`${inputClass} resize-none`} />
              </div>
            </div>

            {error && (
              <p role="alert" className="mt-4 flex items-start gap-2 rounded-sm border border-red-500/40 bg-red-500/10 p-3 font-display text-sm text-red-400">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="group mt-6 flex w-full items-center justify-center gap-2 rounded-sm bg-gold py-4 font-display text-sm font-bold uppercase tracking-widest text-obsidian shadow-[0_10px_30px_-8px_rgba(201,168,112,0.6)] transition hover:brightness-110 disabled:opacity-60"
            >
              {submitting
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Sending…</>
                : <>Book my consultation <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" /></>}
            </button>
            <p className="mt-3 flex items-center justify-center gap-1.5 font-display text-xs text-ink-muted">
              <Phone className="h-3 w-3" /> We reply on WhatsApp or call — no spam.
            </p>
          </form>
        </div>
      </section>

      {/* Trust Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto">
        <div className="text-center mb-14">
          <p className="font-display text-[10px] uppercase tracking-[0.28em] text-gold mb-2">Why Autobacs</p>
          <h2 className="text-3xl md:text-4xl font-display font-light text-ink tracking-[-0.01em]">Built for Enthusiasts. Trusted by Owners.</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {TRUST_ITEMS.map(({ icon: Icon, title, desc }) => (
            <div key={title} className="bg-obsidian border border-hairline rounded-sm p-6 hover:border-gold/40 transition-colors group">
              <div className="w-12 h-12 bg-gold/10 rounded-sm flex items-center justify-center mb-4 group-hover:bg-gold/20 transition-colors">
                <Icon className="h-6 w-6 text-gold" />
              </div>
              <h3 className="font-display font-light text-ink tracking-[-0.01em] text-sm mb-2">{title}</h3>
              <p className="text-ink/70 font-display text-sm leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Social Proof */}
      <section className="pb-20 px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            { emoji: '🏎', stat: '500+', label: 'Builds Completed', sub: 'Across India' },
            { emoji: '⭐', stat: '4.9/5', label: 'Customer Rating', sub: 'Based on 200+ reviews' },
            { emoji: '🔧', stat: '15+', label: 'Years Experience', sub: 'In automotive upgrades' },
          ].map(({ emoji, stat, label, sub }) => (
            <div key={label} className="bg-obsidian border border-hairline rounded-sm p-6 text-center hover:border-gold/30 transition-colors">
              <div className="text-4xl mb-3">{emoji}</div>
              <div className="text-3xl font-display font-bold text-ink mb-1">{stat}</div>
              <div className="font-display font-bold text-ink/70 uppercase tracking-wide text-sm">{label}</div>
              <div className="text-ink-muted font-display text-xs mt-1">{sub}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
