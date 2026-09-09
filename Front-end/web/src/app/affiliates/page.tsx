'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, BadgeCheck, CheckCircle, Link2, Wallet } from 'lucide-react';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { GST_STATE_BY_CODE } from '@/lib/legal/buyerTypes';
import { LEGAL_DOCUMENTS } from '@/lib/legal/legalVersions';

/**
 * Public affiliate sign-up.
 *
 * Submitting grants NOTHING — an application is `pending` until an admin approves it, at
 * which point the code and its managed coupon are minted together. That is why this page
 * can be unauthenticated: approval is the capability boundary, not submission.
 *
 * ⚠️ IT COLLECTS PAN AND BANK DETAILS. Both are encrypted at rest the moment they reach
 * the server, and both are deleted if the application is declined. Say so on the page —
 * asking a stranger for a PAN without explaining why, or what happens to it, is how a
 * legitimate form gets mistaken for a phishing one.
 *
 * The copy deliberately avoids naming a commission rate. Rates are per-affiliate and set
 * at approval, so a number printed here would be a promise the admin has not made.
 */

interface FormState {
  name: string;
  email: string;
  phone: string;
  website: string;
  pitch: string;
  panNumber: string;
  gstin: string;
  accountHolderName: string;
  accountNumber: string;
  ifsc: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
}

const EMPTY: FormState = {
  name: '', email: '', phone: '', website: '', pitch: '',
  panNumber: '', gstin: '',
  accountHolderName: '', accountNumber: '', ifsc: '',
  line1: '', line2: '', city: '', state: '', postalCode: '',
};

const STATES = Object.values(GST_STATE_BY_CODE).sort();

const STEPS = [
  {
    icon: Link2,
    title: 'Share your link or code',
    body: 'Approved affiliates get one code that works two ways — as a discount code your audience can type, and as a ?ref= link that remembers the click for weeks afterwards.',
  },
  {
    icon: BadgeCheck,
    title: 'Your audience saves',
    body: 'Your code takes a percentage off their order. They see the discount before they pay, calculated by us — never an estimate.',
  },
  {
    icon: Wallet,
    title: 'You earn on delivered orders',
    body: 'Commission is confirmed once the order has been delivered and the return window has closed, then paid out by bank transfer each month.',
  },
];

const label = 'block text-sm font-medium text-gray-700 mb-1';
const input =
  'w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-400';
const hint = 'mt-1 text-xs text-gray-500';
const section = 'mt-10';
const sectionTitle = 'text-lg font-semibold text-gray-900';

export default function AffiliatesPage() {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const set = (key: keyof FormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const setUpper = (key: keyof FormState) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value.toUpperCase() }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return; // a double-click must not submit twice
    setBusy(true);
    setError(null);

    try {
      await apiClient.post(API_ENDPOINTS.AFFILIATE_APPLY, {
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        website: form.website.trim(),
        panNumber: form.panNumber.trim(),
        accountHolderName: form.accountHolderName.trim(),
        accountNumber: form.accountNumber.trim(),
        ifsc: form.ifsc.trim(),
        address: {
          line1: form.line1.trim(),
          line2: form.line2.trim() || undefined,
          city: form.city.trim(),
          state: form.state,
          postalCode: form.postalCode.trim(),
        },
        // The server stamps WHICH version this binds to — we only assert the box was
        // ticked. A client that could name its own version could pick its contract.
        acceptTerms: true,
        // Optional fields are omitted rather than sent empty: the validators treat a
        // falsy value as absent, and '' would fail the GSTIN pattern.
        ...(form.pitch.trim() ? { pitch: form.pitch.trim() } : {}),
        ...(form.gstin.trim() ? { gstin: form.gstin.trim() } : {}),
      });
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (submitted) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-20 text-center">
        <CheckCircle className="w-14 h-14 mx-auto text-green-600" aria-hidden />
        <h1 className="mt-6 text-3xl font-semibold text-gray-900">Application received</h1>
        <p className="mt-3 text-gray-600">
          We review every application by hand. If you are approved we will email you your
          affiliate code and a link to your dashboard.
        </p>
        <Link
          href="/"
          className="inline-flex items-center gap-2 mt-8 px-5 py-3 rounded-lg bg-gray-900 text-white font-medium hover:bg-gray-800"
        >
          Back to the store <ArrowRight className="w-4 h-4" aria-hidden />
        </Link>
      </main>
    );
  }

  return (
    <main className="max-w-5xl mx-auto px-4 py-12 md:py-16">
      <header className="max-w-2xl">
        <p className="text-sm font-medium uppercase tracking-wide text-gray-500">Affiliate Program</p>
        <h1 className="mt-2 text-4xl font-semibold text-gray-900">Get paid for what you already recommend</h1>
        <p className="mt-4 text-lg text-gray-600">
          If you make car content, build them, or people ask you what to fit — share
          Autobacs India and earn a percentage of every order you bring in.
        </p>
      </header>

      <section className="grid gap-6 md:grid-cols-3 mt-12" aria-label="How the programme works">
        {STEPS.map(({ icon: Icon, title, body }) => (
          <div key={title} className="rounded-xl border border-gray-200 p-6">
            <Icon className="w-6 h-6 text-gray-900" aria-hidden />
            <h2 className="mt-4 font-semibold text-gray-900">{title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-gray-600">{body}</p>
          </div>
        ))}
      </section>

      <section className="mt-14 max-w-xl" aria-label="Application form">
        <h2 className="text-2xl font-semibold text-gray-900">Apply</h2>
        <p className="mt-2 text-sm text-gray-600">
          Applications are reviewed by a person. Commission and discount rates are agreed
          individually when you are approved.
        </p>

        <form onSubmit={handleSubmit} className="mt-8" noValidate>
          {/* ── About you ─────────────────────────────────────────────────── */}
          <fieldset className="space-y-4">
            <legend className={sectionTitle}>About you</legend>

            <div>
              <label className={label} htmlFor="aff-name">Full name *</label>
              <input id="aff-name" className={input} value={form.name} onChange={set('name')}
                required maxLength={120} autoComplete="name" />
              <p className={hint}>As it appears on your PAN — we use it for the bank transfer.</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={label} htmlFor="aff-email">Email *</label>
                <input id="aff-email" type="email" className={input} value={form.email}
                  onChange={set('email')} required maxLength={200} autoComplete="email" />
              </div>
              <div>
                <label className={label} htmlFor="aff-phone">Phone *</label>
                <input id="aff-phone" type="tel" className={input} value={form.phone}
                  onChange={set('phone')} required autoComplete="tel" placeholder="10-digit mobile" />
              </div>
            </div>

            <div>
              <label className={label} htmlFor="aff-website">YouTube channel or social link *</label>
              <input id="aff-website" type="url" className={input} value={form.website}
                onChange={set('website')} required maxLength={500} placeholder="https://youtube.com/@yourchannel" />
              <p className={hint}>Include https:// so we can open it. This is what we review.</p>
            </div>

            <div>
              <label className={label} htmlFor="aff-pitch">How will you promote us?</label>
              <textarea id="aff-pitch" className={`${input} min-h-24`} value={form.pitch}
                onChange={set('pitch')} maxLength={2000}
                placeholder="Tell us about your audience — what you post, roughly how many people you reach." />
              <p className={hint}>{form.pitch.length}/2000</p>
            </div>
          </fieldset>

          {/* ── Tax + payout ──────────────────────────────────────────────── */}
          <fieldset className={`${section} space-y-4`}>
            <legend className={sectionTitle}>Tax and payout details</legend>

            {/*
              Explain WHY before asking. A form that requests a PAN and a bank account
              from someone who has not been accepted yet reads like phishing unless the
              reason and the handling are stated plainly, right next to the fields.
            */}
            <p className="rounded-lg bg-gray-50 border border-gray-200 px-4 py-3 text-sm text-gray-600">
              We ask for these now so we can pay you without chasing paperwork later.
              Your PAN and account number are <strong>encrypted</strong> the moment they
              reach us, are never shown back in full, and are <strong>deleted if your
              application is not approved</strong>. See our{' '}
              <Link href="/privacy" className="underline">Privacy Policy</Link>.
            </p>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={label} htmlFor="aff-pan">PAN *</label>
                <input id="aff-pan" className={`${input} font-mono uppercase`} value={form.panNumber}
                  onChange={setUpper('panNumber')} required maxLength={10} placeholder="ABCDE1234F" />
                <p className={hint}>Required — tax is deducted at source on commission.</p>
              </div>
              <div>
                <label className={label} htmlFor="aff-gstin">GSTIN (if registered)</label>
                <input id="aff-gstin" className={`${input} font-mono uppercase`} value={form.gstin}
                  onChange={setUpper('gstin')} maxLength={15} placeholder="Optional" />
                <p className={hint}>Leave blank if you are not GST-registered.</p>
              </div>
            </div>

            <div>
              <label className={label} htmlFor="aff-holder">Account holder name *</label>
              <input id="aff-holder" className={input} value={form.accountHolderName}
                onChange={set('accountHolderName')} required maxLength={120} />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={label} htmlFor="aff-account">Bank account number *</label>
                <input id="aff-account" className={`${input} font-mono`} value={form.accountNumber}
                  onChange={set('accountNumber')} required inputMode="numeric" />
              </div>
              <div>
                <label className={label} htmlFor="aff-ifsc">IFSC *</label>
                <input id="aff-ifsc" className={`${input} font-mono uppercase`} value={form.ifsc}
                  onChange={setUpper('ifsc')} required maxLength={11} placeholder="HDFC0001234" />
              </div>
            </div>
            <p className={hint}>
              Double-check both — we are not able to recover a transfer sent to a wrong account.
            </p>
          </fieldset>

          {/* ── Address ───────────────────────────────────────────────────── */}
          <fieldset className={`${section} space-y-4`}>
            <legend className={sectionTitle}>Address</legend>
            <p className="text-sm text-gray-600">
              Needed for GST place-of-supply if you ever cross the registration threshold.
            </p>

            <div>
              <label className={label} htmlFor="aff-line1">Address *</label>
              <input id="aff-line1" className={input} value={form.line1}
                onChange={set('line1')} required maxLength={200} autoComplete="address-line1" />
            </div>
            <div>
              <label className={label} htmlFor="aff-line2">Address line 2</label>
              <input id="aff-line2" className={input} value={form.line2}
                onChange={set('line2')} maxLength={200} autoComplete="address-line2" />
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className={label} htmlFor="aff-city">City *</label>
                <input id="aff-city" className={input} value={form.city}
                  onChange={set('city')} required maxLength={100} autoComplete="address-level2" />
              </div>
              <div>
                <label className={label} htmlFor="aff-state">State *</label>
                {/* A select, not free text: place of supply is decided by this value. */}
                <select id="aff-state" className={input} value={form.state}
                  onChange={set('state')} required>
                  <option value="">Select…</option>
                  {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className={label} htmlFor="aff-pin">PIN code *</label>
                <input id="aff-pin" className={input} value={form.postalCode}
                  onChange={set('postalCode')} required inputMode="numeric" maxLength={6}
                  autoComplete="postal-code" />
              </div>
            </div>
          </fieldset>

          {/* ── Terms ─────────────────────────────────────────────────────── */}
          <div className={section}>
            <label className="flex items-start gap-3 text-sm text-gray-700">
              <input
                type="checkbox"
                className="mt-1 shrink-0"
                checked={acceptTerms}
                onChange={(e) => setAcceptTerms(e.target.checked)}
                required
              />
              <span>
                I agree to the{' '}
                <Link href="/affiliates/terms" target="_blank" className="underline font-medium">
                  Affiliate Programme Terms
                </Link>{' '}
                — including how commission is earned and paid, the monthly payout cycle,
                deduction of tax at source, the rule against referring your own orders,
                and how the arrangement can be ended.
              </span>
            </label>
            <p className={hint}>Version {LEGAL_DOCUMENTS.affiliateTerms.version}</p>
          </div>

          {error && (
            <p role="alert" className="mt-6 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || !acceptTerms}
            className="mt-6 w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg bg-gray-900 text-white font-medium hover:bg-gray-800 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {busy ? 'Sending…' : 'Apply to join'}
            {!busy && <ArrowRight className="w-4 h-4" aria-hidden />}
          </button>
        </form>
      </section>
    </main>
  );
}
