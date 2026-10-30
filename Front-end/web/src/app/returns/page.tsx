'use client';

import StorePageHeader from '@/components/store/StorePageHeader';
import { RETURN_WINDOW_DAYS, RETURN_WINDOW_DAYS_OURS } from '@/lib/constants';

export default function ReturnsPage() {
  return (
    <div className="sp sh-theme">
      <StorePageHeader crumbs={[{ label: 'Return and Refund Policy' }]} title={'Return and Refund Policy'} subtitle={<>At Autobacs India, we want you happy with every part you buy. Here is exactly how returns and refunds work.</>} />

      {/* Content */}
      <section className="py-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-obsidian border border-hairline rounded-lg p-8 space-y-10">

            {/* 1. Who pays */}
            <div>
              <h2 className="font-display font-bold text-ink tracking-[-0.01em] text-xl mb-4">1. Whoever caused the problem pays</h2>

              <h3 className="font-display text-ink tracking-[-0.01em] text-sm mb-2">When the fault is ours</h3>
              <p className="text-ink/70 font-display leading-relaxed mb-3">
                A wrong item, damage in transit, a manufacturing defect, a missing part, a product our website said would fit
                your car but does not, or damage caused by our installer. You can raise a return within{' '}
                <strong className="text-ink">{RETURN_WINDOW_DAYS_OURS} days</strong> of delivery, we pay for the pickup, and you get{' '}
                <strong className="text-ink">everything back</strong>: what you paid for the item, its share of the delivery charge, and
                any installation charge on your bill for it.
              </p>

              <h3 className="font-display text-ink tracking-[-0.01em] text-sm mb-2 mt-6">When it is your own reason</h3>
              <p className="text-ink/70 font-display leading-relaxed mb-3">
                You ordered the wrong model or size, or changed your mind. You can raise a return within{' '}
                <strong className="text-ink">{RETURN_WINDOW_DAYS} days</strong> of delivery, as long as:
              </p>
              <ul className="space-y-1.5 mb-4">
                {[
                  'The item is unused, has not been installed, and is in its original box with all accessories, manuals and tags.',
                  'The product is not on the non-returnable list below.',
                ].map(item => (
                  <li key={item} className="flex items-start gap-2 text-ink/70 font-display leading-relaxed">
                    <span className="text-gold mt-1 shrink-0">—</span><span>{item}</span>
                  </li>
                ))}
              </ul>
              <p className="text-ink/70 font-display leading-relaxed mb-3">
                You get back what you paid for the item. The real cost of the pickup is deducted, and the original delivery charge
                and any installation charge are not refunded.
              </p>

              <div className="rounded-lg border border-gold/30 bg-gold/5 p-4 text-sm text-ink/80 font-display leading-relaxed">
                <p className="font-semibold text-ink mb-1">Example</p>
                <p>A dash cam for ₹9,000, installation ₹1,000 and delivery ₹200 — you paid ₹10,200.</p>
                <p>We sent the wrong model: you get <strong>₹10,200</strong> back.</p>
                <p>You ordered the wrong one and the pickup cost ₹300: you get <strong>₹8,700</strong> back.</p>
              </div>

              <h3 className="font-display text-ink tracking-[-0.01em] text-sm mb-2 mt-6">Not returnable for your own reason</h3>
              <ul className="space-y-1.5 mb-4">
                {[
                  'Electrical and electronic items once installed or tested.',
                  'Custom-made or special-order items.',
                  'Imported items marked as non-returnable.',
                  'Anything installed, used, or damaged after delivery.',
                ].map(item => (
                  <li key={item} className="flex items-start gap-2 text-ink/70 font-display leading-relaxed">
                    <span className="text-ink-muted mt-1 shrink-0">—</span><span>{item}</span>
                  </li>
                ))}
              </ul>
              <p className="text-ink/70 font-display leading-relaxed">
                A defective, wrong, or not-as-described item is always accepted, whatever the product.
              </p>
            </div>

            <div className="border-t border-hairline" />

            {/* 2. How it works */}
            <div>
              <h2 className="font-display font-bold text-ink tracking-[-0.01em] text-xl mb-4">2. How a return works</h2>
              <ol className="space-y-3">
                {[
                  { step: '1', label: 'Raise it', desc: 'From My Orders on the website, or call or WhatsApp us and our team raises it for you. Add at least one photo of the problem; a video is needed for transit damage and for any item over ₹10,000.' },
                  { step: '2', label: 'We check your photos', desc: 'Usually within one working day. We tell you by email whether it is approved, and why if it is not.' },
                  { step: '3', label: 'Pickup', desc: 'We arrange the pickup (or you can drop it at our store). If the courier cannot collect it after two attempts, the request is cancelled and we email you.' },
                  { step: '4', label: 'Inspection', desc: 'We check the item. If it was damaged after delivery, the return is declined and the item is sent back at your cost, or held for 30 days and then disposed of.' },
                  { step: '5', label: 'Refund', desc: 'Paid to your original payment method (card, UPI, net banking) — it usually reaches you in 5–9 business days. Orders paid by bank transfer or cash are refunded by bank transfer.' },
                ].map(({ step, label, desc }) => (
                  <li key={step} className="flex items-start gap-4">
                    <span className="shrink-0 w-7 h-7 rounded-full bg-gold/10 border border-gold/30 text-gold font-display font-bold text-xs flex items-center justify-center">{step}</span>
                    <div>
                      <span className="font-display text-ink tracking-[-0.01em] text-sm">{label} — </span>
                      <span className="text-ink/70 font-display text-sm leading-relaxed">{desc}</span>
                    </div>
                  </li>
                ))}
              </ol>
              <p className="text-ink/70 font-display leading-relaxed mt-4">
                We do not offer store credit or a wallet. If you would like a different product instead, our team will help you
                choose it and you place it as a new order.
              </p>
            </div>

            <div className="border-t border-hairline" />

            {/* 3. Unclaimed Products */}
            <div>
              <h2 className="font-display font-bold text-ink tracking-[-0.01em] text-xl mb-4">3. Unclaimed Products Terms</h2>
              <p className="text-ink/70 font-display leading-relaxed mb-6">
                This section outlines the terms and procedures regarding products that remain uncollected by the customer after a purchase, service, repair, or delivery notification.
              </p>

              {[
                {
                  title: 'Definition of Unclaimed Products',
                  body: 'A product is considered unclaimed if it is not collected within 30 days after the customer has been notified—via phone, email, SMS, or any other provided means of contact—that the item is ready for pickup or delivery.',
                },
                {
                  title: 'Storage and Administration Fees',
                  body: 'If a product remains unclaimed for more than 30 days following customer notification, we reserve the right to apply storage and administrative fees. The customer will be informed of the exact fees applicable before collection.',
                },
                {
                  title: 'Final Collection Notice',
                  body: 'If the product remains unclaimed after 60 days, a final written notice will be issued. The customer will then be granted an additional 14 days to arrange collection and pay any outstanding fees.',
                },
                {
                  title: 'Ownership Forfeiture and Disposal',
                  body: 'If the product is still unclaimed after 74 days (60 days + 14-day grace period) and we receive no communication from the customer, the item may be considered forfeited. We reserve the right to dispose of, sell, or repurpose the product to recover incurred costs.',
                },
              ].map(({ title, body }) => (
                <div key={title} className="mb-5">
                  <h3 className="font-display text-ink tracking-[-0.01em] text-sm mb-1">{title}</h3>
                  <p className="text-ink/70 font-display leading-relaxed text-sm">{body}</p>
                </div>
              ))}
            </div>

            <div className="border-t border-hairline" />

            {/* Contact */}
            <div>
              <h2 className="font-display font-bold text-ink tracking-[-0.01em] text-xl mb-4">Contact Us</h2>
              <p className="text-ink/70 font-display leading-relaxed mb-2">
                For any questions about a return or a refund, please contact us:
              </p>
              <p className="text-ink/70 font-display">
                Email:{' '}
                <a href="mailto:support@autobacsindia.com" className="text-gold hover:text-ink transition-colors">
                  support@autobacsindia.com
                </a>
              </p>
              <p className="text-ink-muted font-display text-sm mt-6">
                By purchasing from Autobacs India, you agree to this return and refund policy. We comply with
                The Consumer Protection Act, 2019 and other applicable Indian laws governing consumer rights
                and product returns.
              </p>
            </div>

          </div>
        </div>
      </section>
    </div>
  );
}
