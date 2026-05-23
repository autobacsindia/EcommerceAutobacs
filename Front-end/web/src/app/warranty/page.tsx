import React from 'react';
import Link from 'next/link';

export default function WarrantyPage() {
  return (
    <div className="min-h-screen bg-[#080808]">
      {/* Hero */}
      <section className="bg-[#0E0E0E] border-b border-[#252525]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-20 text-center">
          <p className="text-[#3B9EE8] font-condensed font-bold text-sm uppercase tracking-widest mb-2">Policy</p>
          <h1 className="text-4xl font-condensed font-bold text-white uppercase tracking-wide mb-4">Warranty Information</h1>
          <p className="text-[#C4C4C4] font-body max-w-2xl mx-auto">
            We stand behind the quality of every product we sell.
          </p>
        </div>
      </section>

      {/* Content */}
      <section className="py-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
          <div className="bg-[#0E0E0E] border border-[#252525] rounded-sm p-8">
            <h2 className="font-condensed font-bold text-white uppercase tracking-wide text-xl mb-4">Our Warranty Promise</h2>
            <p className="text-[#C4C4C4] font-body leading-relaxed mb-4">
              At Autobacs India, we stand behind the quality of our products. All products come with a standard
              manufacturer warranty, typically ranging from 6 months to 2 years depending on the product category.
            </p>
            <p className="text-[#C4C4C4] font-body leading-relaxed">
              For specific warranty details regarding your purchase, please refer to the documentation included
              with your product or contact our support team.
            </p>
          </div>

          <div className="bg-[#0E0E0E] border border-[#252525] rounded-sm p-8">
            <h2 className="font-condensed font-bold text-white uppercase tracking-wide text-xl mb-4">What Is Covered</h2>
            <ul className="space-y-2">
              {['Manufacturing defects', 'Material failures under normal use', 'Premature component failure within the warranty period'].map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <div className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[#3B9EE8] shrink-0" />
                  <span className="text-[#C4C4C4] font-body leading-relaxed">{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="bg-[#0E0E0E] border border-[#252525] rounded-sm p-8">
            <h2 className="font-condensed font-bold text-white uppercase tracking-wide text-xl mb-4">What Is Not Covered</h2>
            <ul className="space-y-2">
              {['Damage caused by misuse or accidents', 'Normal wear and tear', 'Improper installation', 'Modifications or alterations to the product'].map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <div className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[#555555] shrink-0" />
                  <span className="text-[#C4C4C4] font-body leading-relaxed">{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="bg-[#3B9EE8]/10 border border-[#3B9EE8]/30 rounded-sm p-6 text-center">
            <p className="text-[#C4C4C4] font-body mb-4">
              Have a warranty claim or need assistance? Our support team is here to help.
            </p>
            <Link
              href="/contact"
              className="inline-block bg-[#3B9EE8] hover:bg-[#1A6FB5] text-white font-condensed font-bold uppercase tracking-widest px-6 py-3 rounded-sm transition-colors"
            >
              Contact Support
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
