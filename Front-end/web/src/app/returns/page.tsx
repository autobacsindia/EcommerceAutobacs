'use client';

import Link from 'next/link';

export default function ReturnsPage() {
  return (
    <div className="min-h-screen bg-obsidian-deep">
      {/* Hero */}
      <section className="bg-obsidian border-b border-hairline">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-20 text-center">
          <p className="text-gold font-display font-bold text-sm uppercase tracking-widest mb-2">Policy</p>
          <h1 className="text-4xl font-display font-bold text-ink uppercase tracking-wide mb-4">Return and Exchange Policy</h1>
          <p className="text-ink/70 font-display max-w-3xl mx-auto">
            At Autobacs India, we strive to ensure customer satisfaction. Please read our policy carefully before making a purchase.
          </p>
        </div>
      </section>

      {/* Content */}
      <section className="py-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-obsidian border border-hairline rounded-sm p-8 space-y-10">

            {/* 1. Return Policy */}
            <div>
              <h2 className="font-display font-bold text-ink uppercase tracking-wide text-xl mb-4">1. Return Policy</h2>

              <h3 className="font-display font-bold text-ink uppercase tracking-wide text-sm mb-2">Eligibility for Returns</h3>
              <p className="text-ink/70 font-display leading-relaxed mb-3">
                You may request a return within <strong className="text-ink">7 calendar days</strong> from the date of receiving your order. To be eligible for a return:
              </p>
              <ul className="space-y-1.5 mb-4">
                {[
                  'The item must be unused, undamaged, and in its original condition as received.',
                  'The item must be returned in its original packaging, including all accessories, manuals, and tags.',
                  'Returns will not be accepted for products that have been installed, used, or damaged after delivery.',
                ].map(item => (
                  <li key={item} className="flex items-start gap-2 text-ink/70 font-display leading-relaxed">
                    <span className="text-gold mt-1 shrink-0">—</span><span>{item}</span>
                  </li>
                ))}
              </ul>

              <h3 className="font-display font-bold text-ink uppercase tracking-wide text-sm mb-2 mt-6">Non-Returnable Items</h3>
              <p className="text-ink/70 font-display leading-relaxed mb-3">The following items cannot be returned:</p>
              <ul className="space-y-1.5 mb-4">
                {[
                  'Custom-made or special-order items.',
                  'Electrical and electronic components once installed or tested.',
                  'Clearance sale or discounted items marked as non-returnable.',
                ].map(item => (
                  <li key={item} className="flex items-start gap-2 text-ink/70 font-display leading-relaxed">
                    <span className="text-ink-muted mt-1 shrink-0">—</span><span>{item}</span>
                  </li>
                ))}
              </ul>

              <h3 className="font-display font-bold text-ink uppercase tracking-wide text-sm mb-2 mt-6">Refund Policy</h3>
              <p className="text-ink/70 font-display leading-relaxed mb-3">
                We do not offer direct refunds. Instead, we provide exchanges or store credit for eligible return cases.
              </p>
              <ul className="space-y-1.5">
                {[
                  'Store credit will be issued for valid return cases and can be used for future purchases within 6 months from the date of issue.',
                  'Once the returned product reaches our warehouse, a quality inspection will be conducted. After successful verification, the refund or store credit will be processed within 7 to 14 business days.',
                ].map(item => (
                  <li key={item} className="flex items-start gap-2 text-ink/70 font-display leading-relaxed">
                    <span className="text-gold mt-1 shrink-0">—</span><span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="border-t border-hairline" />

            {/* 2. Exchange Policy */}
            <div>
              <h2 className="font-display font-bold text-ink uppercase tracking-wide text-xl mb-4">2. Exchange Policy</h2>

              <h3 className="font-display font-bold text-ink uppercase tracking-wide text-sm mb-2">Eligibility for Exchange</h3>
              <p className="text-ink/70 font-display leading-relaxed mb-3">
                You may request an exchange within <strong className="text-ink">7 days</strong> of receiving your order if:
              </p>
              <ul className="space-y-1.5 mb-6">
                {[
                  'The item is defective or has a manufacturing fault.',
                  'You received an incorrect item.',
                  'The item was damaged during transit (requires photographic proof at the time of unboxing).',
                ].map(item => (
                  <li key={item} className="flex items-start gap-2 text-ink/70 font-display leading-relaxed">
                    <span className="text-gold mt-1 shrink-0">—</span><span>{item}</span>
                  </li>
                ))}
              </ul>

              <h3 className="font-display font-bold text-ink uppercase tracking-wide text-sm mb-3">Exchange Process</h3>
              <ol className="space-y-3">
                {[
                  { step: '1', label: 'Initiate a Request', desc: 'Contact our customer support at info@autobacsindia.com within 7 days of receiving the product.' },
                  { step: '2', label: 'Verification', desc: 'Our team will assess the request and provide return instructions if the exchange is approved.' },
                  { step: '3', label: 'Return the Item', desc: 'Send the item back in its original condition and packaging. Shipping costs for returning items may be covered by us if the fault is from our side.' },
                  { step: '4', label: 'Receive the Replacement', desc: 'Once we receive and inspect the returned item, we will ship the replacement product.' },
                ].map(({ step, label, desc }) => (
                  <li key={step} className="flex items-start gap-4">
                    <span className="shrink-0 w-7 h-7 rounded-full bg-gold/10 border border-gold/30 text-gold font-display font-bold text-xs flex items-center justify-center">{step}</span>
                    <div>
                      <span className="font-display font-bold text-ink uppercase tracking-wide text-sm">{label} — </span>
                      <span className="text-ink/70 font-display text-sm leading-relaxed">{desc}</span>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            <div className="border-t border-hairline" />

            {/* 3. Unclaimed Products */}
            <div>
              <h2 className="font-display font-bold text-ink uppercase tracking-wide text-xl mb-4">3. Unclaimed Products Terms</h2>
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
                  <h3 className="font-display font-bold text-ink uppercase tracking-wide text-sm mb-1">{title}</h3>
                  <p className="text-ink/70 font-display leading-relaxed text-sm">{body}</p>
                </div>
              ))}
            </div>

            <div className="border-t border-hairline" />

            {/* Shipping and Costs */}
            <div>
              <h2 className="font-display font-bold text-ink uppercase tracking-wide text-xl mb-4">Shipping and Costs</h2>
              <ul className="space-y-1.5">
                {[
                  'Customers are responsible for return shipping costs unless the return is due to a defective or incorrect item.',
                  'If a replacement is unavailable, we may provide store credit for future purchases.',
                  'Items returned without prior approval will not be accepted.',
                ].map(item => (
                  <li key={item} className="flex items-start gap-2 text-ink/70 font-display leading-relaxed">
                    <span className="text-gold mt-1 shrink-0">—</span><span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="border-t border-hairline" />

            {/* Contact */}
            <div>
              <h2 className="font-display font-bold text-ink uppercase tracking-wide text-xl mb-4">Contact Us</h2>
              <p className="text-ink/70 font-display leading-relaxed mb-2">
                For any questions or assistance regarding returns and exchanges, please contact us:
              </p>
              <p className="text-ink/70 font-display">
                Email:{' '}
                <a href="mailto:info@autobacsindia.com" className="text-gold hover:text-ink transition-colors">
                  info@autobacsindia.com
                </a>
              </p>
              <p className="text-ink-muted font-display text-sm mt-6">
                By purchasing from Autobacs India, you agree to this return and exchange policy. We comply with
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
