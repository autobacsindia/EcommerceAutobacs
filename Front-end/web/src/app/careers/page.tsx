import React from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { buildPageMetadata } from '@/lib/pageSeo';

export const generateMetadata = (): Promise<Metadata> =>
  buildPageMetadata('/careers', {
    title: 'Careers',
    description: 'Join the Autobacs India team and help us revolutionize the automotive accessories industry in India.',
  });

export default function CareersPage() {
  return (
    <div className="min-h-screen bg-obsidian-deep">
      {/* Hero */}
      <section className="bg-obsidian border-b border-hairline">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-20 text-center">
          <p className="font-display text-[10px] uppercase tracking-[0.28em] text-gold mb-2">Join Us</p>
          <h1 className="text-4xl font-display font-light text-ink tracking-[-0.01em] mb-4">Careers at Autobacs</h1>
          <p className="text-ink/70 font-display max-w-2xl mx-auto">
            Join our team and help us revolutionize the automotive industry in India.
          </p>
        </div>
      </section>

      {/* Content */}
      <section className="py-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
          <div className="bg-obsidian border border-hairline rounded-sm p-8">
            <h2 className="font-display font-light text-ink tracking-[-0.01em] text-xl mb-4">Why Work With Us</h2>
            <p className="text-ink/70 font-display leading-relaxed mb-4">
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
                  <div className="mt-1.5 h-1.5 w-1.5 rounded-full bg-gold shrink-0" />
                  <span className="text-ink/70 font-display leading-relaxed">{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="bg-obsidian border border-hairline rounded-sm p-8 text-center">
            <h2 className="font-display font-light text-ink tracking-[-0.01em] text-xl mb-3">Open Positions</h2>
            <p className="text-ink/70 font-display mb-6">
              Currently, we do not have any open positions listed online. Please check back later or send
              your resume directly to us.
            </p>
            <a
              href="mailto:careers@autobacsindia.com"
              className="inline-block bg-gold hover:opacity-90 text-obsidian font-display font-bold uppercase tracking-widest px-6 py-3 rounded-sm transition-colors"
            >
              Send Your Resume
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
