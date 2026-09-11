import type { Metadata } from 'next';
import Link from 'next/link';
import { buildPageMetadata } from '@/lib/pageSeo';
import { LEGAL_DOCUMENTS } from '@/lib/legal/legalVersions';
import { formatLongDateIST } from '@/lib/datetime';

/**
 * Affiliate Programme Terms.
 *
 * ⚠️ THIS PAGE AND ITS COMMITTED SNAPSHOT MUST NOT DRIFT.
 * The text here is mirrored at docs/legal/affiliateTerms-<version>.md, which is the
 * evidential record of what a given affiliate accepted. Any SUBSTANTIVE change needs a
 * new version in Back-end/server/config/legalDocuments.js, its frontend mirror, a new
 * snapshot file, and a Redis/CDN purge — a legal page served stale from an edge cache is
 * the one document where "it expires in an hour" is not an acceptable answer.
 *
 * Server component: no hooks, no handlers, and a client page cannot export
 * generateMetadata — which is what left /terms with no title or canonical for months.
 */
export const generateMetadata = (): Promise<Metadata> =>
  buildPageMetadata('/affiliates/terms', {
    title: 'Affiliate Programme Terms',
    description:
      'The terms of the Autobacs India affiliate programme — how commission is earned and paid, the payout cycle, tax deducted at source, and how the arrangement can be ended.',
  });

// Storefront tokens, not the admin light palette — this prose sat in `text-gray-700`
// over a body hard-set to #080808. See the note in app/account/affiliate/page.tsx.
const h2 = 'text-xl font-display font-light text-ink tracking-[-0.01em] mt-10 mb-3';
const h3 = 'text-base font-display font-bold text-gold uppercase tracking-widest mt-6 mb-2';
const p = 'text-ink-muted font-display leading-relaxed mb-4';
const ul = 'list-disc pl-6 space-y-2 text-ink-muted font-display mb-4';

export default function AffiliateTermsPage() {
  const version = LEGAL_DOCUMENTS.affiliateTerms.version;
  // Derived from the version so a bump cannot leave a stale "last updated" behind.
  // formatLongDateIST, not toLocaleDateString: the runtime TZ is UTC on Vercel, which
  // renders the previous day for an IST reader.
  const lastUpdated = formatLongDateIST(`${version}T00:00:00+05:30`);

  return (
    <main className="min-h-screen bg-obsidian-deep">
      <div className="max-w-3xl mx-auto px-4 py-12 md:py-16">
      <header className="mb-8 pb-6 border-b border-hairline">
        <p className="font-display text-[10px] uppercase tracking-[0.28em] text-gold">Legal</p>
        <h1 className="mt-4 text-3xl font-display font-light text-ink tracking-[-0.01em]">
          Affiliate Programme Terms
        </h1>
        <p className="mt-2 text-sm text-ink-muted font-display">
          Version {version} · Last updated {lastUpdated}
        </p>
      </header>

      <h2 className={h2}>1. What this is</h2>
      <p className={p}>
        These terms govern the Autobacs India Affiliate Programme. By submitting an
        application you agree to them. They form a contract between you (an independent
        promoter) and us. They are <strong>not</strong> an employment, agency, partnership
        or franchise agreement, and nothing in them makes you our employee or gives you
        authority to bind us.
      </p>

      <h2 className={h2}>2. Applying and being accepted</h2>
      <p className={p}>
        Applying does not make you an affiliate. Every application is reviewed by a person,
        and we may accept or decline any application at our discretion and without giving
        reasons. You become an affiliate only when we notify you that you have been
        approved and issue your affiliate code. Until then you have no code, no tracking
        link, and earn nothing. You must be at least 18 and resident in India.
      </p>

      <h2 className={h2}>3. Your code and your link</h2>
      <p className={p}>On approval we issue you a single affiliate code. It works two ways:</p>
      <ul className={ul}>
        <li>as a <strong>discount code</strong> your audience can enter at checkout; and</li>
        <li>as a <strong>tracking link</strong> (<code>?ref=YOURCODE</code>), which records a referral for <strong>30 days</strong> after someone clicks it.</li>
      </ul>
      <p className={p}>
        If a customer enters a different affiliate&apos;s code at checkout, that affiliate
        is credited instead of you, regardless of any earlier click.
      </p>
      <p className={p}>You may promote us on your own website, channel or social accounts. You may <strong>not</strong>:</p>
      <ul className={ul}>
        <li>bid on our brand name or misspellings of it in paid search;</li>
        <li>post your code to coupon, voucher or deal-aggregation sites;</li>
        <li>present yourself as Autobacs India, or as speaking on our behalf;</li>
        <li>make claims about our products, pricing, delivery times or warranties that we have not published;</li>
        <li>use spam, malware, misleading redirects, or any automated traffic generation.</li>
      </ul>

      <h2 className={h2}>4. Commission</h2>

      <h3 className={h3}>4.1 What you earn</h3>
      <p className={p}>
        Your commission rate is agreed individually with you when you are approved and is
        shown on your affiliate dashboard. It is a percentage of the{' '}
        <strong>net goods value</strong> of a qualifying order — the order subtotal after
        any discount, and <strong>excluding delivery charges and taxes</strong>. Unless we
        agree otherwise in writing, commission is payable only on a customer&apos;s{' '}
        <strong>first order</strong>.
      </p>

      <h3 className={h3}>4.2 When it is confirmed</h3>
      <p className={p}>Commission on an order becomes payable only after all of the following:</p>
      <ul className={ul}>
        <li>the order has been paid for and the payment has cleared;</li>
        <li>every item has been delivered; and</li>
        <li>the return window for that order has closed with no return outstanding.</li>
      </ul>
      <p className={p}>
        Until then it shows on your dashboard as <em>pending</em>. Commission on an order
        that is cancelled, returned or refunded is reversed in full, or in proportion to
        the amount refunded.
      </p>

      <h3 className={h3}>4.3 If an order is refunded after you have been paid</h3>
      <p className={p}>
        The reversed amount is carried as a negative balance and set against your future
        earnings. We will not ask you to return money you have already received.
      </p>

      <h3 className={h3}>4.4 What does not earn commission</h3>
      <ul className={ul}>
        <li>Orders you place yourself, or that use your own account, email address or phone number.</li>
        <li>Orders from anyone in your household, or any arrangement designed to route your own purchases through your code.</li>
        <li>Orders where the code was applied by our staff rather than by the customer.</li>
        <li>Orders that are cancelled, unpaid, fraudulent, or charged back.</li>
      </ul>

      <h2 className={h2}>5. Payment</h2>
      <p className={p}>
        Approved commission is paid by bank transfer to the account you registered with us.
      </p>
      <ul className={ul}>
        <li>Payouts are made on a <strong>monthly cycle</strong>, in arrears.</li>
        <li>We pay only when your approved balance is at least <strong>₹1,000</strong>. Below that it carries forward.</li>
        <li>We email you when a transfer is made, showing the gross amount, any tax deducted, and the net transferred.</li>
        <li>You are responsible for the accuracy of the bank details you give us. We are not liable for a transfer made to an account you registered incorrectly.</li>
      </ul>

      <h2 className={h2}>6. Tax</h2>
      <p className={p}>You are an independent contractor and responsible for your own taxes.</p>

      <h3 className={h3}>6.1 Tax deducted at source (TDS)</h3>
      <p className={p}>
        We are required to deduct tax at source from commission payments. Our current
        understanding is that affiliate commission falls under{' '}
        <strong>Section 194H (commission or brokerage)</strong> of the Income-tax Act,
        1961, and that deduction applies once your commission in a financial year exceeds{' '}
        <strong>₹20,000</strong>. Because of this, your <strong>PAN is mandatory</strong>{' '}
        to join. Where PAN is not available, a higher rate of deduction applies by law. We
        will provide the certificate of deduction you need to claim credit.
      </p>
      <p className="text-sm text-ink-muted font-display bg-obsidian-raised border border-hairline rounded-sm px-4 py-3 mb-4">
        <strong>Note.</strong> The section, rate and threshold above reflect our present
        understanding and are being confirmed with our chartered accountant. They may be
        corrected. We will apply the rate our accountant advises, and will tell you the
        rate applied on each payout.
      </p>

      <h3 className={h3}>6.2 GST</h3>
      <p className={p}>
        Your promotional services are a supply for GST purposes, which we understand falls
        under <strong>SAC 9983</strong> at <strong>18%</strong>. GST registration is{' '}
        <strong>your</strong> obligation and generally arises only once your aggregate
        turnover exceeds the registration threshold (₹20,00,000 for most persons and
        states). If you are registered, give us your GSTIN and raise a proper tax invoice;
        we will then pay GST in addition to your commission. If you are not registered, we
        pay commission without GST. This is why we ask for your address and state — place
        of supply for these services depends on where you are located.
      </p>

      <h2 className={h2}>7. Your information</h2>
      <p className={p}>
        To operate the programme we collect and store your name, contact details, PAN, bank
        account details and address. Your PAN and bank account number are{' '}
        <strong>encrypted</strong> in our systems and never displayed back in full — only
        the last four digits of your account are shown. We use this information solely to
        pay you and to meet our tax obligations, and we do not share it with anyone other
        than our bank, our payment providers and the tax authorities. Our{' '}
        <Link href="/privacy" className="text-gold hover:text-gold/80 underline">Privacy Policy</Link> applies. If your
        application is declined, we delete your PAN and bank details.
      </p>

      <h2 className={h2}>8. Ending the arrangement</h2>
      <p className={p}>
        <strong>You</strong> may leave at any time by telling us. We will pay any
        commission already approved in the next cycle.
      </p>
      <p className={p}>
        <strong>We</strong> may suspend or terminate your participation at any time, with
        or without notice, including if we believe you have breached these terms, if your
        promotion damages our reputation, or if we discontinue the programme. On suspension
        your code stops working immediately. Commission already earned on genuine orders is
        still paid. Commission on orders we reasonably believe to be fraudulent,
        self-referred, or obtained in breach of clause 3 may be withheld or reversed.
      </p>
      <p className={p}>
        We may change your commission rate on notice. A change applies only to orders
        placed after it takes effect — orders already placed keep the rate that applied at
        the time.
      </p>

      <h2 className={h2}>9. Changes to these terms</h2>
      <p className={p}>
        We may update these terms. The version in force is published on this page with its
        version date. Continuing to promote us after a change means you accept the updated
        terms.
      </p>

      <h2 className={h2}>10. Liability</h2>
      <p className={p}>
        We are not liable to you for indirect or consequential loss, or for loss of
        anticipated commission arising from downtime, a change to the programme, or its
        discontinuation. Our total liability to you in any 12-month period is limited to
        the commission actually paid to you in that period.
      </p>

      <h2 className={h2}>11. Governing law</h2>
      <p className={p}>
        These terms are governed by the laws of India. The dispute-resolution provisions in
        our <Link href="/terms" className="text-gold hover:text-gold/80 underline">Terms and Conditions</Link> apply to
        disputes under this agreement.
      </p>

      <h2 className={h2}>12. Contact</h2>
      <p className={p}>
        Questions about the programme:{' '}
        <a href="mailto:info@autobacsindia.com" className="text-gold hover:text-gold/80 underline">info@autobacsindia.com</a>
      </p>

      <div className="mt-12 pt-6 border-t border-hairline">
        <Link href="/affiliates" className="text-gold hover:text-gold/80 underline">← Back to the affiliate programme</Link>
      </div>
    </div>
    </main>
  );
}
