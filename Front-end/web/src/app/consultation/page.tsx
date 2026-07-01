'use client';

import { useState, useRef } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  ChevronRight, ChevronLeft, CheckCircle, Zap, Wrench, Shield,
  HeadphonesIcon, Car, Phone, MapPin, User, MessageSquare,
  Calendar, Clock, ArrowRight, Star, Flame, Check,
} from 'lucide-react';
import apiClient from '@/lib/api';

interface FormData {
  name: string;
  whatsapp: string;
  city: string;
  vehicleNumber: string;
  makeModel: string;
  upgrades: string[];
  usage: string;
  drivingStyle: string;
  mode: string;
  preferredDate: string;
  preferredTime: string;
  notes: string;
}

const EMPTY: FormData = {
  name: '', whatsapp: '', city: '',
  vehicleNumber: '', makeModel: '',
  upgrades: [],
  usage: '', drivingStyle: '',
  mode: '',
  preferredDate: '', preferredTime: '',
  notes: '',
};

const STEPS = [
  'Basic Info', 'Vehicle Info', 'Upgrades',
  'Driving Profile', 'Consultation', 'Your Vision',
];

const UPGRADE_OPTIONS = [
  { id: 'Performance Upgrades', icon: '⚡', desc: 'ECU tunes, intake, intercooler' },
  { id: 'Body Kits',           icon: '🚗', desc: 'Full aero kits & bumpers' },
  { id: 'Exhaust Systems',     icon: '🔊', desc: 'Cat-back, downpipe, tips' },
  { id: 'Suspension Setup',    icon: '🔧', desc: 'Coilovers, sway bars' },
  { id: 'Wheels & Tyres',      icon: '⭕', desc: 'Alloys, low-profiles, track rubber' },
  { id: 'Aerodynamics',        icon: '🏎', desc: 'Splitters, wings, diffusers' },
];

const USAGE_OPTIONS = ['Daily', 'Highway', 'Performance', 'City'];
const STYLE_OPTIONS = ['Normal', 'Spirited', 'Aggressive'];
const MODE_OPTIONS  = [
  { id: 'In-Person', icon: '🏪', desc: 'Visit our workshop' },
  { id: 'Online',    icon: '📹', desc: 'Video call consultation' },
];
const TIME_SLOTS = [
  '10:00 AM', '11:00 AM', '12:00 PM',
  '2:00 PM', '3:00 PM', '4:00 PM', '5:00 PM',
];

const TRUST_ITEMS = [
  { icon: Zap,            title: 'Performance-Focused Plans',  desc: 'Every upgrade mapped to your driving goals, not just catalogue picks.' },
  { icon: Wrench,         title: 'Precision Fitment',          desc: 'Body kits, exhausts and suspension tested for your exact make & model.' },
  { icon: Star,           title: 'Premium Products Only',      desc: 'Curated catalogue from global brands — zero compromise on quality.' },
  { icon: HeadphonesIcon, title: 'End-to-End Support',         desc: 'From spec sheet to road test, our team guides every step.' },
];

function validateWhatsApp(value: string): string {
  const digits = value.replace(/[\s\-().+]/g, '');
  const bare = digits.startsWith('91') && digits.length === 12 ? digits.slice(2) : digits;
  if (!/^[6-9]\d{9}$/.test(bare)) {
    return 'Enter a valid 10-digit Indian mobile number (starts with 6–9).';
  }
  return '';
}

const inputClass = 'w-full bg-obsidian-raised border border-hairline text-ink placeholder:text-ink-muted rounded-sm px-4 py-3 focus:outline-none focus:border-gold font-display text-sm transition-colors';

export default function ConsultationPage() {
  const [step, setStep]       = useState(0);
  const [form, setForm]       = useState<FormData>({ ...EMPTY });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted]   = useState(false);
  const [error, setError]     = useState('');
  const [whatsappError, setWhatsappError] = useState('');
  const formRef = useRef<HTMLDivElement>(null);

  function scrollToForm() {
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function toggle(key: keyof FormData, value: string) {
    setForm(prev => {
      const arr = prev[key] as string[];
      return { ...prev, [key]: arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value] };
    });
  }

  function set(key: keyof FormData, value: string) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  function nextStep() {
    if (step === 0) {
      if (!form.name || !form.whatsapp || !form.city) {
        setError('Please fill in your name, WhatsApp number, and city.'); return;
      }
      const waErr = validateWhatsApp(form.whatsapp);
      if (waErr) { setWhatsappError(waErr); setError(waErr); return; }
      setWhatsappError('');
    }
    if (step === 1 && !form.makeModel) {
      setError('Please enter your vehicle make & model.'); return;
    }
    setError('');
    setStep(s => Math.min(s + 1, STEPS.length - 1));
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  }

  function prevStep() {
    setError('');
    setWhatsappError('');
    setStep(s => Math.max(s - 1, 0));
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  }

  async function submit() {
    setSubmitting(true);
    setError('');
    try {
      const data = await apiClient.post<{ success: boolean; message?: string }>('/consultation', form);
      if (!data.success) throw new Error(data.message || 'Submission failed');
      setSubmitted(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const waMsg = encodeURIComponent(
    `Hi Autobacs! I just submitted a Performance Consultation for my ${form.makeModel}. Looking forward to building something great! 🚗`
  );

  const WaIcon = () => (
    <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
  );

  if (submitted) {
    return (
      <div className="min-h-screen bg-obsidian-deep flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center">
          <div className="w-20 h-20 bg-green-500/20 border border-green-500/40 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle className="h-10 w-10 text-green-400" />
          </div>
          <h2 className="text-3xl font-display font-bold text-ink uppercase tracking-wide mb-3">You&apos;re All Set!</h2>
          <p className="text-ink/70 font-display mb-8">
            Our team will review your build profile and reach out within 24 hours.
            Want a faster response? Ping us on WhatsApp now.
          </p>
          <a
            href={`https://wa.me/919895502139?text=${waMsg}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-8 py-4 bg-green-600 hover:bg-green-500 text-ink font-display font-bold uppercase tracking-widest rounded-sm text-sm transition-colors"
          >
            <WaIcon /> Chat on WhatsApp
          </a>
          <div className="mt-6">
            <Link href="/" className="text-ink-muted hover:text-ink/70 font-display text-sm transition-colors">
              ← Back to Home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-obsidian-deep min-h-screen text-ink">

      {/* Hero */}
      <section className="relative min-h-[88vh] flex items-center justify-center overflow-hidden">
        <Image
          src="https://images.unsplash.com/photo-1544636331-e26879cd4d9b?auto=format&fit=crop&w=1400&q=60&fm=webp"
          alt="Performance car workshop"
          fill
          priority
          sizes="100vw"
          className="object-cover"
        />
        <div className="absolute inset-0 bg-linear-to-br from-black/85 via-black/70 to-gold/40" />
        <div className="absolute inset-0 bg-linear-to-t from-obsidian-deep via-transparent to-transparent" />

        <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="inline-flex items-center gap-2 bg-gold/10 border border-gold/30 rounded-full px-4 py-1.5 text-gold text-sm font-display font-bold uppercase tracking-widest mb-6 backdrop-blur-sm">
            <Flame className="h-4 w-4" />
            Premium Performance Consultations
          </div>
          <h1 className="text-5xl md:text-7xl font-display font-black tracking-tight mb-4 leading-none uppercase">
            Performance Upgrade
            <span className="block text-gold">Consultation</span>
          </h1>
          <p className="text-xl md:text-2xl text-ink font-light mb-3">Build It Right. Drive It Better.</p>
          <p className="text-ink/70 font-display max-w-2xl mx-auto mb-10 leading-relaxed">
            Get a personalised upgrade plan engineered for your exact vehicle,
            driving style, and goals — by experts who live and breathe performance.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button
              onClick={scrollToForm}
              className="px-8 py-4 bg-gold hover:bg-gold text-obsidian font-display font-bold uppercase tracking-widest rounded-sm text-sm transition-colors flex items-center justify-center gap-2 group shadow-lg shadow-[#3B9EE8]/20"
            >
              Book Your Consultation
              <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
            </button>
            <a
              href="https://wa.me/919895502139"
              target="_blank"
              rel="noopener noreferrer"
              className="px-8 py-4 bg-green-600/20 hover:bg-green-600/30 border border-green-500/40 text-green-400 font-display font-bold uppercase tracking-widest rounded-sm text-sm transition-colors flex items-center justify-center gap-2"
            >
              <WaIcon /> Quick WhatsApp Chat
            </a>
          </div>
        </div>
      </section>

      {/* Trust Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto">
        <div className="text-center mb-14">
          <p className="text-gold font-display font-bold text-sm uppercase tracking-widest mb-2">Why Autobacs</p>
          <h2 className="text-3xl md:text-4xl font-display font-bold text-ink uppercase tracking-wide">Built for Enthusiasts. Trusted by Owners.</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {TRUST_ITEMS.map(({ icon: Icon, title, desc }) => (
            <div key={title} className="bg-obsidian border border-hairline rounded-sm p-6 hover:border-gold/40 transition-colors group">
              <div className="w-12 h-12 bg-gold/10 rounded-sm flex items-center justify-center mb-4 group-hover:bg-gold/20 transition-colors">
                <Icon className="h-6 w-6 text-gold" />
              </div>
              <h3 className="font-display font-bold text-ink uppercase tracking-wide text-sm mb-2">{title}</h3>
              <p className="text-ink/70 font-display text-sm leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Multi-step Form */}
      <section ref={formRef} className="py-12 px-4 sm:px-6 lg:px-8 max-w-3xl mx-auto scroll-mt-8">
        <div className="text-center mb-10">
          <p className="text-gold font-display font-bold text-sm uppercase tracking-widest mb-2">Get Started</p>
          <h2 className="text-3xl md:text-4xl font-display font-bold text-ink uppercase tracking-wide mb-2">Build Your Upgrade Profile</h2>
          <p className="text-ink/70 font-display">Takes 3 minutes. Transforms your build.</p>
        </div>

        {/* Progress bar */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-ink/70 font-display">Step {step + 1} of {STEPS.length}</span>
            <span className="text-sm font-display font-bold text-gold uppercase tracking-wide">{STEPS[step]}</span>
          </div>
          <div className="h-1.5 bg-obsidian-raised rounded-full overflow-hidden">
            <div
              className="h-full bg-gold rounded-full transition-all duration-500"
              style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
            />
          </div>
          <div className="flex justify-between mt-2">
            {STEPS.map((s, i) => (
              <div key={s} className={`text-xs transition-colors ${i <= step ? 'text-gold' : 'text-ink-muted'}`}>
                <div className={`w-2 h-2 rounded-full mx-auto mb-1 ${i < step ? 'bg-gold' : i === step ? 'bg-gold ring-2 ring-gold/30' : 'bg-obsidian-raised'}`} />
              </div>
            ))}
          </div>
        </div>

        {/* Form card */}
        <div className="bg-obsidian border border-hairline rounded-sm p-6 md:p-8">

          {/* Step 0: Basic Info */}
          {step === 0 && (
            <div className="space-y-5">
              <div>
                <h3 className="text-xl font-display font-bold text-ink uppercase tracking-wide mb-1 flex items-center gap-2">
                  <User className="h-5 w-5 text-gold" /> Basic Information
                </h3>
                <p className="text-ink/70 font-display text-sm mb-4">Let us know who you are so we can personalise your consultation.</p>
              </div>
              <div>
                <label className="block text-xs font-display font-bold text-ink-muted uppercase tracking-widest mb-1.5">
                  Full Name <span className="text-gold">*</span>
                </label>
                <input
                  value={form.name}
                  onChange={e => set('name', e.target.value)}
                  placeholder="e.g. Rahul Sharma"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs font-display font-bold text-ink-muted uppercase tracking-widest mb-1.5">
                  <Phone className="inline h-3.5 w-3.5 mr-1" />WhatsApp Number <span className="text-gold">*</span>
                </label>
                <div className="relative">
                  <input
                    value={form.whatsapp}
                    onChange={e => {
                      set('whatsapp', e.target.value);
                      setWhatsappError(e.target.value ? validateWhatsApp(e.target.value) : '');
                    }}
                    placeholder="e.g. 98765 43210 or +91 98765 43210"
                    type="tel"
                    inputMode="numeric"
                    maxLength={15}
                    className={`${inputClass} pr-10 ${
                      whatsappError
                        ? 'border-red-500 focus:border-red-400'
                        : form.whatsapp && !whatsappError
                        ? 'border-green-500 focus:border-green-400'
                        : ''
                    }`}
                  />
                  {form.whatsapp && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      {whatsappError
                        ? <span className="text-red-400 text-lg">✗</span>
                        : <span className="text-green-400 text-lg">✓</span>
                      }
                    </div>
                  )}
                </div>
                {whatsappError && (
                  <p className="text-red-400 font-display text-xs mt-1.5 flex items-center gap-1">
                    <span>⚠</span> {whatsappError}
                  </p>
                )}
                {form.whatsapp && !whatsappError && (
                  <p className="text-green-400 font-display text-xs mt-1.5">✓ Valid Indian mobile number</p>
                )}
                <p className="text-ink-muted font-display text-xs mt-1">Accepted: 10-digit number, or with +91 / 91 prefix</p>
              </div>
              <div>
                <label className="block text-xs font-display font-bold text-ink-muted uppercase tracking-widest mb-1.5">
                  <MapPin className="inline h-3.5 w-3.5 mr-1" />City <span className="text-gold">*</span>
                </label>
                <input
                  value={form.city}
                  onChange={e => set('city', e.target.value)}
                  placeholder="e.g. Mumbai"
                  className={inputClass}
                />
              </div>
            </div>
          )}

          {/* Step 1: Vehicle Info */}
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <h3 className="text-xl font-display font-bold text-ink uppercase tracking-wide mb-1 flex items-center gap-2">
                  <Car className="h-5 w-5 text-gold" /> Vehicle Information
                </h3>
                <p className="text-ink/70 font-display text-sm mb-4">Tell us about your car — the more detail, the better we can plan.</p>
              </div>
              <div>
                <label className="block text-xs font-display font-bold text-ink-muted uppercase tracking-widest mb-1.5">Vehicle Registration Number</label>
                <input
                  value={form.vehicleNumber}
                  onChange={e => set('vehicleNumber', e.target.value)}
                  placeholder="e.g. MH 01 AB 1234"
                  className={inputClass + ' uppercase'}
                />
              </div>
              <div>
                <label className="block text-xs font-display font-bold text-ink-muted uppercase tracking-widest mb-1.5">
                  Make &amp; Model <span className="text-gold">*</span>
                </label>
                <input
                  value={form.makeModel}
                  onChange={e => set('makeModel', e.target.value)}
                  placeholder="e.g. Honda Civic 2022, Ford Endeavour"
                  className={inputClass}
                />
              </div>
              <div className="bg-obsidian-raised border border-hairline rounded-sm p-4 flex items-start gap-3">
                <Shield className="h-4 w-4 text-green-400 shrink-0 mt-0.5" />
                <p className="text-ink/70 font-display text-xs">Your vehicle details help us check exact fitment compatibility for all recommended upgrades.</p>
              </div>
            </div>
          )}

          {/* Step 2: Upgrades */}
          {step === 2 && (
            <div className="space-y-5">
              <div>
                <h3 className="text-xl font-display font-bold text-ink uppercase tracking-wide mb-1 flex items-center gap-2">
                  <Zap className="h-5 w-5 text-gold" /> Choose Your Upgrades
                </h3>
                <p className="text-ink/70 font-display text-sm mb-4">Select all that interest you — mix and match freely.</p>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {UPGRADE_OPTIONS.map(({ id, icon, desc }) => {
                  const sel = form.upgrades.includes(id);
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => toggle('upgrades', id)}
                      className={`relative p-4 rounded-sm border-2 text-left transition-all ${sel ? 'border-gold bg-gold/10' : 'border-hairline bg-obsidian-raised hover:border-gold/40'}`}
                    >
                      {sel && (
                        <div className="absolute top-2 right-2 w-5 h-5 bg-gold rounded-full flex items-center justify-center">
                          <Check className="h-3 w-3 text-ink" />
                        </div>
                      )}
                      <span className="text-2xl mb-2 block">{icon}</span>
                      <p className={`font-display font-bold text-sm mb-1 uppercase tracking-wide ${sel ? 'text-gold' : 'text-ink'}`}>{id}</p>
                      <p className="text-ink-muted font-display text-xs">{desc}</p>
                    </button>
                  );
                })}
              </div>
              {form.upgrades.length > 0 && (
                <p className="text-xs text-green-400 font-display flex items-center gap-1">
                  <Check className="h-3.5 w-3.5" /> {form.upgrades.length} upgrade{form.upgrades.length > 1 ? 's' : ''} selected
                </p>
              )}
            </div>
          )}

          {/* Step 3: Driving Profile */}
          {step === 3 && (
            <div className="space-y-7">
              <div>
                <h3 className="text-xl font-display font-bold text-ink uppercase tracking-wide mb-1 flex items-center gap-2">
                  <Flame className="h-5 w-5 text-gold" /> Your Driving Profile
                </h3>
                <p className="text-ink/70 font-display text-sm">This helps us tune recommendations to how you actually drive.</p>
              </div>
              <div>
                <p className="text-xs font-display font-bold text-ink-muted uppercase tracking-widest mb-3">Primary Usage</p>
                <div className="flex flex-wrap gap-2">
                  {USAGE_OPTIONS.map(u => (
                    <button
                      key={u}
                      type="button"
                      onClick={() => set('usage', u)}
                      className={`px-5 py-2.5 rounded-sm text-sm font-display font-bold uppercase tracking-wide border-2 transition-all ${form.usage === u ? 'border-gold bg-gold/10 text-gold' : 'border-hairline text-obsidian/70 hover:border-gold/40'}`}
                    >
                      {u}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-display font-bold text-ink-muted uppercase tracking-widest mb-3">Driving Style</p>
                <div className="flex flex-wrap gap-2">
                  {STYLE_OPTIONS.map(s => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => set('drivingStyle', s)}
                      className={`px-5 py-2.5 rounded-sm text-sm font-display font-bold uppercase tracking-wide border-2 transition-all ${form.drivingStyle === s ? 'border-gold bg-gold/10 text-gold' : 'border-hairline text-obsidian/70 hover:border-gold/40'}`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 4: Consultation Preference */}
          {step === 4 && (
            <div className="space-y-7">
              <div>
                <h3 className="text-xl font-display font-bold text-ink uppercase tracking-wide mb-1 flex items-center gap-2">
                  <Calendar className="h-5 w-5 text-gold" /> Consultation Preference
                </h3>
                <p className="text-ink/70 font-display text-sm">How and when would you like to meet our experts?</p>
              </div>
              <div>
                <p className="text-xs font-display font-bold text-ink-muted uppercase tracking-widest mb-3">Mode</p>
                <div className="grid grid-cols-2 gap-3">
                  {MODE_OPTIONS.map(({ id, icon, desc }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => set('mode', id)}
                      className={`p-4 rounded-sm border-2 text-left transition-all ${form.mode === id ? 'border-gold bg-gold/10' : 'border-hairline bg-obsidian-raised hover:border-gold/40'}`}
                    >
                      <span className="text-2xl block mb-1">{icon}</span>
                      <p className={`font-display font-bold text-sm uppercase tracking-wide ${form.mode === id ? 'text-gold' : 'text-ink'}`}>{id}</p>
                      <p className="text-ink-muted font-display text-xs">{desc}</p>
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="flex items-center gap-1 text-xs font-display font-bold text-ink-muted uppercase tracking-widest mb-1.5">
                    <Calendar className="h-3.5 w-3.5" /> Preferred Date
                  </label>
                  <input
                    type="date"
                    value={form.preferredDate}
                    min={new Date().toISOString().split('T')[0]}
                    onChange={e => set('preferredDate', e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="flex items-center gap-1 text-xs font-display font-bold text-ink-muted uppercase tracking-widest mb-1.5">
                    <Clock className="h-3.5 w-3.5" /> Preferred Time
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {TIME_SLOTS.map(t => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => set('preferredTime', t)}
                        className={`px-3 py-1.5 rounded-sm text-xs font-display font-bold uppercase tracking-wide border transition-all ${form.preferredTime === t ? 'border-gold bg-gold/10 text-gold' : 'border-hairline text-obsidian/70 hover:border-gold/40'}`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 5: Vision */}
          {step === 5 && (
            <div className="space-y-5">
              <div>
                <h3 className="text-xl font-display font-bold text-ink uppercase tracking-wide mb-1 flex items-center gap-2">
                  <MessageSquare className="h-5 w-5 text-gold" /> Your Build Vision
                </h3>
                <p className="text-ink/70 font-display text-sm mb-4">
                  Describe what you want to achieve. Be as specific as you like — louder exhaust, track-day setup, aggressive look, etc.
                </p>
              </div>
              <textarea
                value={form.notes}
                onChange={e => set('notes', e.target.value)}
                placeholder="e.g. I want a stage 2 tune with a cat-back exhaust, coilover suspension, and a widebody kit for my Civic..."
                rows={6}
                className={inputClass + ' resize-none'}
              />
              {/* Summary */}
              <div className="bg-obsidian-raised border border-hairline rounded-sm p-4">
                <p className="font-display font-bold text-ink/70 uppercase tracking-wide text-xs mb-3">Your Profile Summary</p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div><span className="text-ink-muted font-display">Name:</span> <span className="text-ink font-display">{form.name}</span></div>
                  <div><span className="text-ink-muted font-display">City:</span> <span className="text-ink font-display">{form.city}</span></div>
                  <div><span className="text-ink-muted font-display">Vehicle:</span> <span className="text-ink font-display">{form.makeModel}</span></div>
                  <div><span className="text-ink-muted font-display">Mode:</span> <span className="text-ink font-display">{form.mode || '—'}</span></div>
                  <div className="col-span-2"><span className="text-ink-muted font-display">Upgrades:</span> <span className="text-ink font-display">{form.upgrades.length > 0 ? form.upgrades.join(', ') : '—'}</span></div>
                </div>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-sm text-red-400 font-display text-sm">
              {error}
            </div>
          )}

          {/* Navigation */}
          <div className="flex items-center justify-between mt-8 pt-6 border-t border-hairline">
            <button
              type="button"
              onClick={prevStep}
              disabled={step === 0}
              className={`flex items-center gap-2 px-5 py-3 rounded-sm font-display font-bold uppercase tracking-wide text-sm transition-all ${step === 0 ? 'opacity-0 pointer-events-none' : 'text-ink/70 hover:text-ink hover:bg-obsidian-raised'}`}
            >
              <ChevronLeft className="h-4 w-4" /> Back
            </button>

            {step < STEPS.length - 1 ? (
              <button
                type="button"
                onClick={nextStep}
                className="flex items-center gap-2 px-8 py-3 bg-gold hover:bg-gold text-obsidian font-display font-bold uppercase tracking-widest rounded-sm transition-colors shadow-lg shadow-[#3B9EE8]/20 group text-sm"
              >
                Continue <ChevronRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={submitting}
                className="flex items-center gap-2 px-8 py-3 bg-gold hover:bg-gold text-obsidian font-display font-bold uppercase tracking-widest rounded-sm transition-colors shadow-lg shadow-[#3B9EE8]/20 disabled:opacity-50 text-sm"
              >
                {submitting ? (
                  <><span className="w-4 h-4 border-2 border-hairline/30 border-t-white rounded-full animate-spin" /> Submitting...</>
                ) : (
                  <>Get My Build Plan <Zap className="h-4 w-4" /></>
                )}
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Social Proof */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto">
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

      {/* Final CTA */}
      <section className="py-16 px-4">
        <div className="max-w-3xl mx-auto text-center bg-obsidian border border-hairline rounded-sm p-10 md:p-16">
          <h2 className="text-3xl md:text-4xl font-display font-bold text-ink uppercase tracking-wide mb-4">Ready to Build Your Dream Machine?</h2>
          <p className="text-ink/70 font-display mb-8 text-lg">Every iconic build starts with one conversation. Yours is waiting.</p>
          <button
            onClick={scrollToForm}
            className="px-10 py-4 bg-gold hover:bg-gold text-obsidian font-display font-bold uppercase tracking-widest rounded-sm text-sm transition-colors shadow-lg shadow-[#3B9EE8]/20 inline-flex items-center gap-3"
          >
            Get My Build Plan <Zap className="h-5 w-5" />
          </button>
        </div>
      </section>

      {/* Floating WhatsApp */}
      <a
        href="https://wa.me/919895502139"
        target="_blank"
        rel="noopener noreferrer"
        className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-green-500 hover:bg-green-400 rounded-full flex items-center justify-center shadow-2xl shadow-green-500/40 transition-all hover:scale-110"
        aria-label="WhatsApp"
      >
        <svg className="h-7 w-7 text-ink" fill="currentColor" viewBox="0 0 24 24">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
        </svg>
      </a>
    </div>
  );
}
