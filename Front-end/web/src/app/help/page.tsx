import React from 'react';
import Link from 'next/link';

export default function HelpPage() {
  return (
    <div className="min-h-screen bg-[#080808]">
      {/* Hero */}
      <section className="bg-[#0E0E0E] border-b border-[#252525]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-20 text-center">
          <p className="text-[#3B9EE8] font-condensed font-bold text-sm uppercase tracking-widest mb-2">Support</p>
          <h1 className="text-4xl font-condensed font-bold text-white uppercase tracking-wide mb-4">Help Centre</h1>
          <p className="text-[#C4C4C4] font-body max-w-2xl mx-auto">
            Find answers to common questions below, or reach out to our team directly.
          </p>
        </div>
      </section>

      {/* Content */}
      <section className="py-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
          {[
            {
              title: 'Ordering',
              body: 'Browse products using the search bar or category menus. Add items to your cart and proceed to checkout. You will receive a confirmation email once your order is placed.',
            },
            {
              title: 'Payments',
              body: 'We accept UPI, debit/credit cards, and net banking via Razorpay. All transactions are encrypted and secure. Cash on delivery is not currently available.',
            },
            {
              title: 'Vehicle Compatibility',
              body: 'Use the vehicle selector on any product page to filter parts that fit your specific make, model, and year. Our catalogue is regularly updated to ensure accuracy.',
            },
          ].map((section) => (
            <div key={section.title} className="bg-[#0E0E0E] border border-[#252525] rounded-sm p-6">
              <h2 className="font-condensed font-bold text-white uppercase tracking-wide text-xl mb-3">{section.title}</h2>
              <p className="text-[#C4C4C4] font-body leading-relaxed">{section.body}</p>
            </div>
          ))}

          <div className="bg-[#0E0E0E] border border-[#252525] rounded-sm p-6">
            <h2 className="font-condensed font-bold text-white uppercase tracking-wide text-xl mb-3">Shipping & Delivery</h2>
            <p className="text-[#C4C4C4] font-body leading-relaxed">
              Orders are typically dispatched within 1–2 business days. Delivery times vary by location.
              You can track your order from the{' '}
              <Link href="/orders" className="text-[#3B9EE8] hover:text-white transition-colors">My Orders</Link>{' '}
              page.
            </p>
          </div>

          <div className="bg-[#0E0E0E] border border-[#252525] rounded-sm p-6">
            <h2 className="font-condensed font-bold text-white uppercase tracking-wide text-xl mb-3">Returns & Refunds</h2>
            <p className="text-[#C4C4C4] font-body leading-relaxed">
              Items can be returned within 7 days of delivery if unused and in original packaging. Visit our{' '}
              <Link href="/returns" className="text-[#3B9EE8] hover:text-white transition-colors">Returns page</Link>{' '}
              to initiate a return request.
            </p>
          </div>

          <div className="bg-[#0E0E0E] border border-[#252525] rounded-sm p-6">
            <h2 className="font-condensed font-bold text-white uppercase tracking-wide text-xl mb-3">Account & Password</h2>
            <p className="text-[#C4C4C4] font-body leading-relaxed">
              If you have forgotten your password, use the{' '}
              <Link href="/forgot-password" className="text-[#3B9EE8] hover:text-white transition-colors">Forgot Password</Link>{' '}
              link on the login page to reset it via email.
            </p>
          </div>

          {/* Contact box */}
          <div className="bg-[#3B9EE8]/10 border border-[#3B9EE8]/30 rounded-sm p-6">
            <h2 className="font-condensed font-bold text-white uppercase tracking-wide text-xl mb-3">Contact Support</h2>
            <p className="text-[#C4C4C4] font-body mb-4">Our support team is available Monday – Saturday, 10 AM – 6 PM IST.</p>
            <ul className="space-y-2">
              <li className="text-[#C4C4C4] font-body">
                Email:{' '}
                <Link href="mailto:support@autobacsindia.com" className="text-[#3B9EE8] hover:text-white transition-colors">
                  support@autobacsindia.com
                </Link>
              </li>
              <li className="text-[#C4C4C4] font-body">Phone: +91 9895257905</li>
              <li className="text-[#C4C4C4] font-body">
                Contact form:{' '}
                <Link href="/contact" className="text-[#3B9EE8] hover:text-white transition-colors">Contact Us</Link>
              </li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
