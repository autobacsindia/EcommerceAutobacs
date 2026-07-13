'use client';

import { MapPin, Phone, Mail, Clock, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

const SUPPORT_EMAIL = 'support@autobacsindia.com';
const SUPPORT_PHONE_DISPLAY = '+91 98952 57905';
const SUPPORT_PHONE_TEL = '+919895257905';
const SUPPORT_WHATSAPP = 'https://wa.me/919895257905';

// lucide-react has no WhatsApp glyph; brand mark inlined.
function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.71.306 1.263.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.002-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

function ContactPageInner() {
  const searchParams = useSearchParams();
  // Deep-link support: /contact?orderId=123 (or ?subject=...) prefills the email subject.
  const orderId = searchParams.get('orderId');
  const subjectParam = searchParams.get('subject');
  const emailSubject = orderId
    ? `Assistance with Order #${orderId}`
    : subjectParam || 'Support request';
  const mailtoHref = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(emailSubject)}`;

  const contactInfo = [
    {
      icon: <MapPin className="h-5 w-5 text-gold" />,
      title: 'Headquarters',
      details: ['9th Floor, Jomer Symphony', 'Chalikkavattom, Ponnurunni North', 'Vyttila']
    },
    {
      icon: <Phone className="h-5 w-5 text-gold" />,
      title: 'Phone',
      details: [SUPPORT_PHONE_DISPLAY]
    },
    {
      icon: <Mail className="h-5 w-5 text-gold" />,
      title: 'Email',
      details: [SUPPORT_EMAIL]
    },
    {
      icon: <Clock className="h-5 w-5 text-gold" />,
      title: 'Working Hours',
      details: ['Monday - Saturday: 10:00 AM - 6:00 PM', 'Sunday: Closed']
    }
  ];

  return (
    <div className="min-h-screen bg-obsidian-deep">
      {/* Hero */}
      <section className="bg-obsidian border-b border-hairline">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-20 text-center">
          <p className="font-display text-[10px] uppercase tracking-[0.28em] text-gold mb-2">Support</p>
          <h1 className="text-4xl font-display font-light text-ink tracking-[-0.01em] mb-4">Contact Us</h1>
          <p className="text-ink/70 font-display max-w-2xl mx-auto">
            Have questions or need assistance? We&apos;re here to help you with all your automotive needs.
          </p>
        </div>
      </section>

      {/* Contact Info + Form */}
      <section className="py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
            {/* Contact Info */}
            <div>
              <h2 className="text-2xl font-display font-light text-ink tracking-[-0.01em] mb-4">Get In Touch</h2>
              <p className="text-ink/70 font-display mb-8">
                We&apos;d love to hear from you! Whether you have a question about our products, need help with an order,
                or want to explore partnership opportunities, our team is ready to assist you.
              </p>
              <div className="space-y-6">
                {contactInfo.map((item, index) => (
                  <div key={index} className="flex gap-4">
                    <div className="shrink-0 mt-0.5">{item.icon}</div>
                    <div>
                      <h3 className="font-display font-light text-ink tracking-[-0.01em] text-sm mb-1">{item.title}</h3>
                      <ul className="space-y-0.5">
                        {item.details.map((detail, idx) => (
                          <li key={idx} className="text-ink/70 font-display text-sm">{detail}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Direct support (replaces the old message form) */}
            <div>
              <h2 className="text-2xl font-display font-light text-ink tracking-[-0.01em] mb-6">Talk to Support</h2>
              <div className="bg-obsidian border border-hairline rounded-sm p-6 sm:p-8 space-y-5">
                <p className="text-ink/70 font-display text-sm">
                  Reach our customer support team directly. Email us or give us a call and we&apos;ll
                  help you with orders, products, or anything else — we typically respond within one business day.
                </p>

                <a
                  href={mailtoHref}
                  className="group flex items-center gap-4 bg-obsidian-raised border border-hairline hover:border-gold rounded-sm p-5 transition-colors"
                >
                  <Mail className="h-6 w-6 text-gold shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[10px] font-display font-bold uppercase tracking-widest text-ink-muted mb-1">Email us</p>
                    <p className="text-ink font-display text-sm truncate">{SUPPORT_EMAIL}</p>
                  </div>
                  <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-ink-muted transition-colors group-hover:text-gold" />
                </a>

                <a
                  href={`tel:${SUPPORT_PHONE_TEL}`}
                  className="group flex items-center gap-4 bg-obsidian-raised border border-hairline hover:border-gold rounded-sm p-5 transition-colors"
                >
                  <Phone className="h-6 w-6 text-gold shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[10px] font-display font-bold uppercase tracking-widest text-ink-muted mb-1">Call us</p>
                    <p className="text-ink font-display text-sm">{SUPPORT_PHONE_DISPLAY}</p>
                  </div>
                  <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-ink-muted transition-colors group-hover:text-gold" />
                </a>

                <a
                  href={SUPPORT_WHATSAPP}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-center gap-4 bg-obsidian-raised border border-hairline hover:border-gold rounded-sm p-5 transition-colors"
                >
                  <WhatsAppIcon className="h-6 w-6 text-gold shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[10px] font-display font-bold uppercase tracking-widest text-ink-muted mb-1">WhatsApp</p>
                    <p className="text-ink font-display text-sm">{SUPPORT_PHONE_DISPLAY}</p>
                  </div>
                  <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-ink-muted transition-colors group-hover:text-gold" />
                </a>

                <div className="flex items-center gap-2 pt-1 text-ink-muted font-display text-xs">
                  <Clock className="h-4 w-4 shrink-0" />
                  <span>Mon&ndash;Sat, 10:00 AM &ndash; 6:00 PM IST</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ strip */}
      <section className="py-16 bg-obsidian border-t border-hairline">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <p className="font-display text-[10px] uppercase tracking-[0.28em] text-gold mb-2">Quick Answers</p>
            <h2 className="text-2xl font-display font-light text-ink tracking-[-0.01em]">Frequently Asked Questions</h2>
            <p className="text-ink/70 font-display mt-2">Find answers to common questions about our services</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[
              { q: 'How long does shipping take?', a: 'Standard shipping typically takes 3-5 business days within India. Express shipping options are available at checkout.' },
              { q: 'What is your return policy?', a: 'We offer a 30-day return policy for unused items in original packaging. Visit our Returns page for more details.' },
              { q: 'Do you ship internationally?', a: 'Currently, we only ship within India. International shipping is planned for the future.' },
              { q: 'How can I track my order?', a: "Once your order ships, you'll receive a tracking number via email. You can also track your order in your account dashboard." },
            ].map((item, i) => (
              <div key={i} className="bg-obsidian-raised border border-hairline rounded-sm p-6">
                <h3 className="font-display font-light text-ink tracking-[-0.01em] text-sm mb-2">{item.q}</h3>
                <p className="text-ink/70 font-display text-sm">{item.a}</p>
              </div>
            ))}
          </div>
          <div className="text-center mt-10">
            <Link href="/faq" className="inline-block bg-gold hover:opacity-90 text-obsidian font-display font-bold uppercase tracking-widest px-6 py-3 rounded-sm transition-colors">
              View All FAQs
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

export default function ContactPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-obsidian-deep" />}>
      <ContactPageInner />
    </Suspense>
  );
}
