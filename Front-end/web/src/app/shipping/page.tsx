'use client';

import Link from 'next/link';
import { Truck, Clock, MapPin, CreditCard } from 'lucide-react';

export default function ShippingPage() {
  const lastUpdated = 'December 9, 2025';

  return (
    <div className="min-h-screen bg-[#080808]">
      {/* Hero */}
      <section className="bg-[#0E0E0E] border-b border-[#252525]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-20 text-center">
          <p className="text-[#3B9EE8] font-condensed font-bold text-sm uppercase tracking-widest mb-2">Policy</p>
          <h1 className="text-4xl font-condensed font-bold text-white uppercase tracking-wide mb-4">Shipping & Delivery</h1>
          <p className="text-[#C4C4C4] font-body max-w-3xl mx-auto">
            Learn about our shipping options, delivery times, and policies to ensure your order arrives safely and on time.
          </p>
        </div>
      </section>

      {/* Content */}
      <section className="py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

          {/* Feature highlights */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            <div className="bg-[#0E0E0E] border border-[#252525] rounded-sm p-6 flex items-start gap-4">
              <Truck className="h-8 w-8 text-[#3B9EE8] shrink-0 mt-0.5" />
              <div>
                <h3 className="font-condensed font-bold text-white uppercase tracking-wide mb-1">Nationwide Coverage</h3>
                <p className="text-[#C4C4C4] font-body text-sm leading-relaxed">
                  We ship to all major cities and towns across India, ensuring that automotive enthusiasts everywhere can access our premium parts.
                </p>
              </div>
            </div>
            <div className="bg-[#0E0E0E] border border-[#252525] rounded-sm p-6 flex items-start gap-4">
              <Clock className="h-8 w-8 text-[#3B9EE8] shrink-0 mt-0.5" />
              <div>
                <h3 className="font-condensed font-bold text-white uppercase tracking-wide mb-1">Fast Delivery</h3>
                <p className="text-[#C4C4C4] font-body text-sm leading-relaxed">
                  Our standard delivery takes 3–5 business days, with express options available for urgent needs.
                </p>
              </div>
            </div>
          </div>

          <div className="bg-[#0E0E0E] border border-[#252525] rounded-sm p-8 mb-6">
            <p className="text-[#555555] font-body text-sm mb-8">Last Updated: {lastUpdated}</p>

            <div className="space-y-10">

              {/* Shipping Options Table */}
              <div>
                <h2 className="font-condensed font-bold text-white uppercase tracking-wide text-xl mb-4">Shipping Options</h2>
                <div className="overflow-x-auto">
                  <table className="min-w-full">
                    <thead>
                      <tr className="border-b border-[#252525]">
                        <th className="px-4 py-3 text-left text-xs font-condensed font-bold text-[#555555] uppercase tracking-widest">Service</th>
                        <th className="px-4 py-3 text-left text-xs font-condensed font-bold text-[#555555] uppercase tracking-widest">Delivery Time</th>
                        <th className="px-4 py-3 text-left text-xs font-condensed font-bold text-[#555555] uppercase tracking-widest">Cost</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#252525]">
                      {[
                        {
                          name: 'Standard Shipping',
                          sub: 'Ground delivery',
                          time: '3–5 business days',
                          cost: ['Free for orders over ₹2,999', '₹199 for orders under ₹2,999'],
                        },
                        {
                          name: 'Express Shipping',
                          sub: 'Priority delivery',
                          time: '1–2 business days',
                          cost: ['₹399 (flat rate)'],
                        },
                        {
                          name: 'Same-Day Delivery',
                          sub: 'Metro areas only',
                          time: 'Same day (before 4 PM cutoff)',
                          cost: ['₹599 (flat rate)'],
                        },
                      ].map(row => (
                        <tr key={row.name}>
                          <td className="px-4 py-4">
                            <div className="font-condensed font-bold text-white text-sm">{row.name}</div>
                            <div className="text-[#555555] font-body text-xs mt-0.5">{row.sub}</div>
                          </td>
                          <td className="px-4 py-4 text-[#C4C4C4] font-body text-sm">{row.time}</td>
                          <td className="px-4 py-4">
                            {row.cost.map(c => (
                              <div key={c} className="text-[#C4C4C4] font-body text-sm">{c}</div>
                            ))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="border-t border-[#252525]" />

              {/* Delivery Areas */}
              <div>
                <h2 className="font-condensed font-bold text-white uppercase tracking-wide text-xl mb-3">Delivery Areas</h2>
                <p className="text-[#C4C4C4] font-body leading-relaxed mb-4">
                  We currently ship to all major metropolitan areas and towns across India. For remote locations,
                  delivery times may be extended by 1–2 business days.
                </p>
                <h3 className="font-condensed font-bold text-white uppercase tracking-wide text-sm mb-3">Major Metro Areas Covered</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                  {['Delhi NCR', 'Mumbai', 'Bengaluru', 'Chennai', 'Kolkata', 'Hyderabad', 'Pune', 'Ahmedabad', 'Jaipur', 'Chandigarh'].map(city => (
                    <div key={city} className="bg-[#161616] border border-[#252525] rounded-sm px-3 py-1.5 text-[#C4C4C4] font-body text-xs text-center">{city}</div>
                  ))}
                </div>
              </div>

              <div className="border-t border-[#252525]" />

              {/* Order Processing */}
              <div>
                <h2 className="font-condensed font-bold text-white uppercase tracking-wide text-xl mb-3">Order Processing</h2>
                <p className="text-[#C4C4C4] font-body leading-relaxed mb-4">
                  Orders are typically processed within 1–2 business days. Orders placed after 2 PM will be
                  processed the next business day. Processing time does not include weekends or holidays.
                </p>
                <div className="bg-yellow-500/10 border-l-4 border-yellow-500 p-4 flex items-start gap-3">
                  <CreditCard className="h-5 w-5 text-yellow-400 shrink-0 mt-0.5" />
                  <p className="text-yellow-300 font-body text-sm leading-relaxed">
                    <strong>Note:</strong> Pre-orders and backordered items may have different shipping timelines.
                    You&apos;ll receive a separate notification with estimated delivery dates for these items.
                  </p>
                </div>
              </div>

              <div className="border-t border-[#252525]" />

              {/* Tracking */}
              <div>
                <h2 className="font-condensed font-bold text-white uppercase tracking-wide text-xl mb-3">Tracking Your Order</h2>
                <p className="text-[#C4C4C4] font-body leading-relaxed">
                  Once your order ships, you&apos;ll receive a shipping confirmation email with tracking information.
                  You can also track your order status in your account dashboard under &quot;My Orders&quot;.
                  Tracking updates are typically available within 24 hours of shipment.
                </p>
              </div>

              <div className="border-t border-[#252525]" />

              {/* Delivery Process */}
              <div>
                <h2 className="font-condensed font-bold text-white uppercase tracking-wide text-xl mb-4">Delivery Process</h2>
                <ol className="space-y-3">
                  {[
                    { label: 'Order Confirmation', desc: 'Receive an email confirming your order' },
                    { label: 'Processing', desc: 'Our team prepares your order (1–2 business days)' },
                    { label: 'Shipment', desc: 'Order is handed to our shipping partner' },
                    { label: 'In Transit', desc: 'Track your package using the provided tracking number' },
                    { label: 'Out for Delivery', desc: 'Package is on its way to your address' },
                    { label: 'Delivered', desc: 'Package is delivered to your specified location' },
                  ].map(({ label, desc }, i) => (
                    <li key={label} className="flex items-start gap-4">
                      <span className="shrink-0 w-7 h-7 rounded-full bg-[#3B9EE8]/10 border border-[#3B9EE8]/30 text-[#3B9EE8] font-condensed font-bold text-xs flex items-center justify-center">{i + 1}</span>
                      <div>
                        <span className="font-condensed font-bold text-white uppercase tracking-wide text-sm">{label}: </span>
                        <span className="text-[#C4C4C4] font-body text-sm">{desc}</span>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>

              <div className="border-t border-[#252525]" />

              {/* Undelivered Packages */}
              <div>
                <h2 className="font-condensed font-bold text-white uppercase tracking-wide text-xl mb-3">Undelivered Packages</h2>
                <p className="text-[#C4C4C4] font-body leading-relaxed mb-3">If a delivery attempt fails, our shipping partner will:</p>
                <ol className="space-y-2">
                  {[
                    'Leave a notice at your address with re-delivery information',
                    'Attempt a second delivery within 2 business days',
                    'If the second attempt fails, the package will be held at the local facility for 7 days',
                    'After 7 days, unclaimed packages will be returned to us and a refund will be issued minus return shipping costs',
                  ].map((item, i) => (
                    <li key={item} className="flex items-start gap-3 text-[#C4C4C4] font-body text-sm leading-relaxed">
                      <span className="text-[#3B9EE8] font-condensed font-bold shrink-0">{i + 1}.</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ol>
              </div>

              <div className="border-t border-[#252525]" />

              {/* International / Restrictions */}
              <div>
                <h2 className="font-condensed font-bold text-white uppercase tracking-wide text-xl mb-3">International Shipping</h2>
                <p className="text-[#C4C4C4] font-body leading-relaxed mb-6">
                  Currently, we only ship within India. We are working on expanding our services to international
                  destinations in the near future.
                </p>
                <h2 className="font-condensed font-bold text-white uppercase tracking-wide text-xl mb-3">Shipping Restrictions</h2>
                <p className="text-[#C4C4C4] font-body leading-relaxed">
                  Some products may have shipping restrictions due to size, weight, or hazardous material
                  considerations. These restrictions will be noted on the product page.
                </p>
              </div>

              <div className="border-t border-[#252525]" />

              {/* Contact + related */}
              <div>
                <h2 className="font-condensed font-bold text-white uppercase tracking-wide text-xl mb-3">Need Help?</h2>
                <p className="text-[#C4C4C4] font-body leading-relaxed mb-2">
                  AutoBacs India Customer Service — Email:{' '}
                  <Link href="mailto:support@autobacsindia.com" className="text-[#3B9EE8] hover:text-white transition-colors">
                    support@autobacsindia.com
                  </Link>
                  {' '}— Phone: +91 9895257905 — Hours: Monday – Saturday, 10:00 AM – 6:00 PM IST
                </p>
              </div>
            </div>
          </div>

          {/* Related links */}
          <div className="bg-[#3B9EE8]/10 border border-[#3B9EE8]/30 rounded-sm p-6">
            <h3 className="font-condensed font-bold text-white uppercase tracking-wide text-sm mb-3">Related Information</h3>
            <p className="text-[#C4C4C4] font-body text-sm mb-2">
              For information about returns and exchanges, please see our{' '}
              <Link href="/returns" className="text-[#3B9EE8] hover:text-white transition-colors">Return Policy</Link>.
            </p>
            <p className="text-[#C4C4C4] font-body text-sm">
              For questions about order status, visit our{' '}
              <Link href="/faq" className="text-[#3B9EE8] hover:text-white transition-colors">FAQ page</Link>{' '}
              or contact our support team.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
