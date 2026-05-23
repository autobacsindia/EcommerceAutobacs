import React from 'react';
import Link from 'next/link';

export default function PrivacyPage() {
  const lastUpdated = 'December 9, 2025';

  return (
    <div className="min-h-screen bg-[#080808]">
      {/* Hero */}
      <section className="bg-[#0E0E0E] border-b border-[#252525]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-20 text-center">
          <p className="text-[#3B9EE8] font-condensed font-bold text-sm uppercase tracking-widest mb-2">Legal</p>
          <h1 className="text-4xl font-condensed font-bold text-white uppercase tracking-wide mb-4">Privacy Policy</h1>
          <p className="text-[#C4C4C4] font-body max-w-2xl mx-auto">
            Your privacy is important to us. This policy outlines how we collect, use, and protect your personal information.
          </p>
        </div>
      </section>

      {/* Content */}
      <section className="py-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-[#0E0E0E] border border-[#252525] rounded-sm p-8">
            <p className="text-[#555555] font-body text-sm mb-8">Last Updated: {lastUpdated}</p>

            <div className="space-y-8">
              <div>
                <h2 className="font-condensed font-bold text-white uppercase tracking-wide text-xl mb-3">Information We Collect</h2>
                <p className="text-[#C4C4C4] font-body leading-relaxed">
                  We collect information you provide directly to us, such as when you create an account, make a
                  purchase, or contact us for support. This includes your name, email address, phone number,
                  shipping address, and payment information.
                </p>
              </div>

              <div className="border-t border-[#252525] pt-8">
                <h2 className="font-condensed font-bold text-white uppercase tracking-wide text-xl mb-3">How We Use Your Information</h2>
                <p className="text-[#C4C4C4] font-body leading-relaxed mb-4">
                  We use the information we collect to provide, maintain, and improve our services, process
                  transactions, and communicate with you. Specifically, we use your information to:
                </p>
                <ul className="space-y-2">
                  {[
                    'Process and fulfill your orders',
                    'Send order confirmations and shipping updates',
                    'Respond to your comments and questions',
                    'Send you marketing communications (with your consent)',
                    'Improve our website and services',
                    'Comply with legal obligations',
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-3">
                      <div className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[#3B9EE8] shrink-0" />
                      <span className="text-[#C4C4C4] font-body leading-relaxed">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="border-t border-[#252525] pt-8">
                <h2 className="font-condensed font-bold text-white uppercase tracking-wide text-xl mb-3">Data Security</h2>
                <p className="text-[#C4C4C4] font-body leading-relaxed">
                  We implement appropriate technical and organisational measures to protect your personal
                  information against unauthorised access, alteration, disclosure, or destruction. All payment
                  transactions are encrypted using SSL technology.
                </p>
              </div>

              <div className="border-t border-[#252525] pt-8">
                <h2 className="font-condensed font-bold text-white uppercase tracking-wide text-xl mb-3">Cookies</h2>
                <p className="text-[#C4C4C4] font-body leading-relaxed">
                  We use cookies and similar tracking technologies to track activity on our website and hold
                  certain information. You can instruct your browser to refuse all cookies or to indicate when
                  a cookie is being sent.
                </p>
              </div>

              <div className="border-t border-[#252525] pt-8">
                <h2 className="font-condensed font-bold text-white uppercase tracking-wide text-xl mb-3">Your Rights</h2>
                <p className="text-[#C4C4C4] font-body leading-relaxed mb-4">
                  You have the right to access, update, or delete the information we hold about you. You may
                  also object to processing, request restriction, or request portability of your personal data.
                </p>
              </div>

              <div className="border-t border-[#252525] pt-8">
                <h2 className="font-condensed font-bold text-white uppercase tracking-wide text-xl mb-3">Contact Us</h2>
                <p className="text-[#C4C4C4] font-body leading-relaxed">
                  If you have any questions about this Privacy Policy, please contact us at{' '}
                  <Link href="mailto:support@autobacsindia.com" className="text-[#3B9EE8] hover:text-white transition-colors">
                    support@autobacsindia.com
                  </Link>{' '}
                  or visit our{' '}
                  <Link href="/contact" className="text-[#3B9EE8] hover:text-white transition-colors">
                    Contact page
                  </Link>.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
