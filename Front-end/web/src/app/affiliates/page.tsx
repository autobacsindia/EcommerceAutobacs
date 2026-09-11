'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowRight, BadgeCheck, CheckCircle, Link2, Wallet } from 'lucide-react';
import apiClient from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useMyAffiliate } from '@/hooks/queries/useAffiliate';
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

/*
  ⚠️ DEDUPE — the map is code→name, and two GST codes legitimately share a name:
  28/37 are both "Andhra Pradesh" (28 is the pre-bifurcation code) and 26/DD are both
  "Dadra and Nagar Haveli and Daman and Diu" (post-merger). Taking Object.values()
  straight listed each of those TWICE in the dropdown and made React warn about
  duplicate keys.

  Fixed here rather than in buyerTypes.ts: the map itself is right, and its test asserts
  the exact key set against the server's list. This is a display list derived from it.
*/
const STATES = [...new Set(Object.values(GST_STATE_BY_CODE))].sort();

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

/*
  Storefront tokens (globals.css @theme), not the admin light palette.

  This page shipped in `text-gray-700` on `border-gray-300` — over a body hard-set to
  #080808. The inputs were partly rescued by the global `input {}` rules; the LABELS
  and hints were not, so the form asked strangers for a PAN and a bank account in text
  they could barely read. Mirrors the pairing in app/profile/page.tsx.
*/
const label = 'block text-xs font-display font-bold text-ink-muted uppercase tracking-widest mb-1';
const input =
  'w-full bg-obsidian-raised border border-hairline text-ink placeholder:text-ink-muted rounded-sm px-3 py-2 focus:outline-none focus:border-gold font-display text-sm';
const hint = 'mt-1 text-xs text-ink-muted font-display';
const section = 'mt-10';
const sectionTitle = 'text-sm font-display font-bold text-gold uppercase tracking-widest';
const primaryBtn =
  'inline-flex items-center justify-center gap-2 px-5 py-3 rounded-sm bg-gold text-obsidian font-display font-bold uppercase tracking-widest text-sm hover:opacity-90 transition disabled:opacity-50 disabled:cursor-not-allowed';

export default function AffiliatesPage() {
  /*
    Gated on `isAuthenticated`: this page is public, and GET /affiliates/me is `protect`ed,
    so firing it for anonymous visitors would 401 on every single view of the marketing
    page. Signed-in visitors get the answer from cache if they have been to /profile.
  */
  const { isAuthenticated, isLoading: authLoading, user } = useAuth();
  const { data: existing, isPending: affiliatePending } = useMyAffiliate(isAuthenticated);

  const [form, setForm] = useState<FormState>(EMPTY);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  /*
    ⚠️ THE LINK BETWEEN AN APPLICATION AND AN ACCOUNT IS THE EMAIL. GET IT RIGHT HERE.

    `Affiliate.user` is what the dashboard resolves by. A signed-in applicant who typed a
    different address than the one they log in with produces an application that can never
    be linked to them — no dashboard, no ledger, no payout history — and nothing downstream
    can repair it, because no automatic path can know the two addresses are the same person.

    So when we KNOW who they are, we take the decision away: prefill from the session and
    make the field read-only. Mismatching stops being a mistake someone can make.

    Signed-out applicants keep a free-text field — the form is public on purpose and
    requiring an account loses applicants at the door — and are told, right on the field,
    to use their sign-in email. The server then links them the moment that address is
    verified.
  */
  useEffect(() => {
    if (isAuthenticated && user?.email) {
      setForm((prev) => (prev.email === user.email ? prev : { ...prev, email: user.email }));
    }
  }, [isAuthenticated, user?.email]);

  const emailLockedToAccount = Boolean(isAuthenticated && user?.email);

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
      <main className="min-h-screen bg-obsidian-deep px-4 py-20">
        <div className="max-w-2xl mx-auto text-center">
          <CheckCircle className="w-14 h-14 mx-auto text-gold" aria-hidden />
          <h1 className="mt-6 text-3xl font-display font-light text-ink tracking-[-0.01em]">
            Application received
          </h1>
          <p className="mt-3 text-ink-muted font-display">
            We review every application by hand. If you are approved we will email you your
            affiliate code and a link to your dashboard.
          </p>
          <Link href="/" className={`mt-8 ${primaryBtn}`}>
            Back to the store <ArrowRight className="w-4 h-4" aria-hidden />
          </Link>
        </div>
      </main>
    );
  }

  /*
    Already in the programme — do not show them the application form again.

    An approved affiliate landing here (from the footer, or a bookmark) previously saw a
    blank form asking for the PAN and bank details they had already given us, with no
    indication they were accepted. Re-submitting would have been refused as a duplicate
    on `email`, with no explanation of why.

    `pending` and `rejected` get a sentence and no link: the dashboard would only repeat
    the same sentence behind a click. `suspended` DOES get the link — their ledger is
    still there.
  */
  /*
    ⚠️ Hold the render until we know, but ONLY for signed-in visitors.

    `isPending` stays true forever on a DISABLED query, so gating on it alone would mean
    an anonymous visitor — the overwhelming majority here — never sees the form at all.

    Without the gate an approved affiliate arriving from the footer link gets a full flash
    of the apply form (PAN, account number, IFSC) before it swaps away, discarding
    anything they had begun typing. That is precisely the state this branch exists to
    prevent, so rendering it first would be self-defeating.
  */
  if (authLoading || (isAuthenticated && affiliatePending)) {
    return (
      <main className="min-h-screen bg-obsidian-deep px-4 py-20">
        <div className="max-w-2xl mx-auto text-center">
          <div className="animate-spin rounded-full h-12 w-12 mx-auto border-b-2 border-gold" />
          <span className="sr-only">Loading</span>
        </div>
      </main>
    );
  }

  const affiliate = existing?.affiliate;
  if (affiliate) {
    const live = affiliate.status === 'active' || affiliate.status === 'suspended';
    return (
      <main className="min-h-screen bg-obsidian-deep px-4 py-20">
        <div className="max-w-2xl mx-auto text-center">
          <p className="font-display text-[10px] uppercase tracking-[0.28em] text-gold">
            Affiliate Programme
          </p>
          <h1 className="mt-4 text-3xl font-display font-light text-ink tracking-[-0.01em]">
            {affiliate.status === 'active' && 'You are already an affiliate'}
            {affiliate.status === 'suspended' && 'Your affiliate account is paused'}
            {affiliate.status === 'pending' && 'Your application is under review'}
            {affiliate.status === 'rejected' && 'Your application was not accepted'}
          </h1>
          <p className="mt-3 text-ink-muted font-display">
            {affiliate.status === 'active' && (
              <>
                Your code{' '}
                <strong className="font-mono text-ink">{affiliate.code}</strong> is live.
                Your link, earnings and referred orders are on your dashboard.
              </>
            )}
            {affiliate.status === 'suspended'
              && 'New referrals are not being credited. Your earnings so far are still listed on your dashboard.'}
            {affiliate.status === 'pending'
              && 'We review every application by hand. You will get an email once a decision is made.'}
            {affiliate.status === 'rejected'
              && 'Get in touch if you think circumstances have changed.'}
          </p>
          {live ? (
            <Link href="/account/affiliate" className={`mt-8 ${primaryBtn}`}>
              Open your dashboard <ArrowRight className="w-4 h-4" aria-hidden />
            </Link>
          ) : (
            <Link
              href="/support"
              className="inline-block mt-8 font-display text-sm text-gold hover:text-gold/80"
            >
              Contact support
            </Link>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-obsidian-deep">
      <div className="max-w-5xl mx-auto px-4 py-12 md:py-16">
      <header className="max-w-2xl">
        <p className="font-display text-[10px] uppercase tracking-[0.28em] text-gold">Affiliate Programme</p>
        <h1 className="mt-4 text-[clamp(34px,5vw,60px)] font-display font-light leading-[0.95] tracking-[-0.01em] text-ink">
          Get paid for what you already recommend
        </h1>
        <p className="mt-6 text-lg text-ink-muted font-display">
          If you make car content, build them, or people ask you what to fit — share
          Autobacs India and earn a percentage of every order you bring in.
        </p>
      </header>

      <section className="grid gap-6 md:grid-cols-3 mt-12" aria-label="How the programme works">
        {STEPS.map(({ icon: Icon, title, body }) => (
          <div key={title} className="bg-obsidian border border-hairline rounded-lg p-6">
            <Icon className="w-6 h-6 text-gold" aria-hidden />
            <h2 className="mt-4 font-display font-light text-ink tracking-[-0.01em]">{title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted font-display">{body}</p>
          </div>
        ))}
      </section>

      <section className="mt-14 max-w-xl" aria-label="Application form">
        <h2 className="text-2xl font-display font-light text-ink tracking-[-0.01em]">Apply</h2>

        {/*
          Encourage, never require. Signing in first is the only route that CANNOT go
          wrong, but gating the form on it would lose the applicants this programme is
          for — creators who have never shopped with us and have no account yet.
        */}
        {!isAuthenticated && (
          <p className="mt-4 rounded-sm border border-gold/30 bg-gold/5 px-4 py-3 text-sm text-ink-muted font-display">
            <strong className="text-ink">Already have an account?</strong>{' '}
            <Link href={`/login?redirect=${encodeURIComponent('/affiliates')}`} className="text-gold hover:text-gold/80 underline">
              Sign in first
            </Link>{' '}
            and we will link this application to it automatically — that is what puts your
            earnings on your dashboard. Otherwise, apply with the email you will sign in
            with.
          </p>
        )}

        <p className="mt-4 text-sm text-ink-muted font-display">
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
                <input
                  id="aff-email" type="email" value={form.email}
                  onChange={set('email')} required maxLength={200} autoComplete="email"
                  readOnly={emailLockedToAccount}
                  aria-describedby="aff-email-hint"
                  className={`${input}${emailLockedToAccount ? ' opacity-70 cursor-not-allowed' : ''}`}
                />
                <p id="aff-email-hint" className={hint}>
                  {emailLockedToAccount
                    ? 'Your account email — we will link this application to it, so your earnings show up on your dashboard.'
                    : 'Use the email you sign in with. Your dashboard unlocks once that address is verified.'}
                </p>
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
            <p className="rounded-sm bg-obsidian-raised border border-hairline px-4 py-3 text-sm text-ink-muted font-display">
              We ask for these now so we can pay you without chasing paperwork later.
              Your PAN and account number are <strong>encrypted</strong> the moment they
              reach us, are never shown back in full, and are <strong className="text-ink">deleted if your
              application is not approved</strong>. See our{' '}
              <Link href="/privacy" className="text-gold hover:text-gold/80 underline">Privacy Policy</Link>.
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
            <p className="text-sm text-ink-muted font-display">
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
            <label className="flex items-start gap-3 text-sm text-ink-muted font-display">
              <input
                type="checkbox"
                className="mt-1 shrink-0"
                checked={acceptTerms}
                onChange={(e) => setAcceptTerms(e.target.checked)}
                required
              />
              <span>
                I agree to the{' '}
                <Link href="/affiliates/terms" target="_blank" className="text-gold hover:text-gold/80 underline">
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
            <p role="alert" className="mt-6 text-sm font-display text-red-300 bg-red-500/10 border border-red-500/30 rounded-sm px-3 py-2">
              {error}
            </p>
          )}

          <button type="submit" disabled={busy || !acceptTerms} className={`mt-6 w-full ${primaryBtn}`}>
            {busy ? 'Sending…' : 'Apply to join'}
            {!busy && <ArrowRight className="w-4 h-4" aria-hidden />}
          </button>
        </form>
      </section>
      </div>
    </main>
  );
}
