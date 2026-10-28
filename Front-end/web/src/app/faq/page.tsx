'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { FAQ_CATEGORIES } from '@/lib/help/faq';
import { whatsappLink } from '@/lib/contactInfo';
import StorePageHeader from '@/components/store/StorePageHeader';

export default function FAQPage() {
  const faqCategories = FAQ_CATEGORIES;

  return (
    <div className="sp sh-theme">
      <StorePageHeader crumbs={[{ label: 'Frequently Asked Questions' }]} title={'Frequently Asked Questions'} subtitle={<>Find answers to common questions about our products, services, and policies.</>} />

      {/* FAQ Content */}
      <section className="py-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-12 text-center">
            <h2 className="text-2xl font-display font-bold text-ink tracking-[-0.01em] mb-3">How can we help you?</h2>
            <p className="text-ink/70 font-display max-w-2xl mx-auto">
              Browse our FAQ categories below or contact our support team if you can&apos;t find what you&apos;re looking for.
            </p>
          </div>

          <div className="space-y-6">
            {faqCategories.map((category, categoryIndex) => (
              <div key={categoryIndex} className="bg-obsidian border border-hairline rounded-lg overflow-hidden">
                <div className="bg-obsidian-raised border-b border-hairline px-6 py-4">
                  <h3 className="font-display text-ink tracking-[-0.01em]">{category.title}</h3>
                </div>
                <div className="p-6">
                  <div className="space-y-5">
                    {category.faqs.map((faq, faqIndex) => (
                      <div key={faqIndex} className="border-b border-hairline pb-5 last:border-b-0 last:pb-0">
                        <h4 className="font-display text-ink tracking-[-0.01em] text-sm mb-2">{faq.question}</h4>
                        <p className="text-ink/70 font-display text-sm leading-relaxed">{faq.answer}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Still Need Help */}
          <div className="mt-12 bg-gold/10 border border-gold/30 rounded-lg p-8 text-center">
            <h3 className="text-xl font-display font-bold text-ink tracking-[-0.01em] mb-3">Still need help?</h3>
            <p className="text-ink/70 font-display mb-6 max-w-xl mx-auto">
              Can&apos;t find the answer you&apos;re looking for? Our customer support team is here to help you.
            </p>
            <div className="flex flex-col sm:flex-row justify-center gap-4">
              <Link href="/contact" className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-gold hover:opacity-90 text-white font-display font-bold rounded-full transition-colors">
                Contact Us
                <ChevronRight className="h-4 w-4" />
              </Link>
              {/* There is no /support/chat page — this link 404'd. WhatsApp is
                  where a person actually answers. */}
              <a href={whatsappLink('Hi, I have a question that the FAQ did not answer.')} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center px-6 py-3 bg-obsidian-raised border border-hairline text-ink/70 hover:text-ink font-display font-bold rounded-full transition-colors">
                Chat on WhatsApp
              </a>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
