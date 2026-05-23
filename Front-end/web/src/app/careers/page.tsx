import React from 'react';
import Link from 'next/link';

export default function CareersPage() {
  return (
    <div className="min-h-screen bg-[#080808]">
      {/* Hero */}
      <section className="bg-[#0E0E0E] border-b border-[#252525]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-20 text-center">
          <p className="text-[#3B9EE8] font-condensed font-bold text-sm uppercase tracking-widest mb-2">Join Us</p>
          <h1 className="text-4xl font-condensed font-bold text-white uppercase tracking-wide mb-4">Careers at Autobacs</h1>
          <p className="text-[#C4C4C4] font-body max-w-2xl mx-auto">
            Join our team and help us revolutionize the automotive industry in India.
          </p>
        </div>
      </section>

      {/* Content */}
      <section className="py-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
          <div className="bg-[#0E0E0E] border border-[#252525] rounded-sm p-8">
            <h2 className="font-condensed font-bold text-white uppercase tracking-wide text-xl mb-4">Why Work With Us</h2>
            <p className="text-[#C4C4C4] font-body leading-relaxed mb-4">
              We are always looking for passionate individuals to help us bring premium automotive parts and
              accessories to enthusiasts across India. If you love cars and want to be part of a growing team,
              we&apos;d love to hear from you.
            </p>
            <ul className="space-y-2">
              {[
                'Work with a passionate team of automotive enthusiasts',
                'Be part of a growing e-commerce platform',
                'Competitive compensation and growth opportunities',
                'Collaborative and innovative work environment',
              ].map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <div className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[#3B9EE8] shrink-0" />
                  <span className="text-[#C4C4C4] font-body leading-relaxed">{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="bg-[#0E0E0E] border border-[#252525] rounded-sm p-8 text-center">
            <h2 className="font-condensed font-bold text-white uppercase tracking-wide text-xl mb-3">Open Positions</h2>
            <p className="text-[#C4C4C4] font-body mb-6">
              Currently, we do not have any open positions listed online. Please check back later or send
              your resume directly to us.
            </p>
            <a
              href="mailto:careers@autobacsindia.com"
              className="inline-block bg-[#3B9EE8] hover:bg-[#1A6FB5] text-white font-condensed font-bold uppercase tracking-widest px-6 py-3 rounded-sm transition-colors"
            >
              Send Your Resume
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
