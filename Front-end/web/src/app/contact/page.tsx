'use client';

import { useState, useEffect } from 'react';
import { MapPin, Phone, Mail, Clock, Send, AlertCircle, CheckCircle } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { ContactService } from '@/lib/services';

function ContactPageInner() {
  const searchParams = useSearchParams();
  const [formData, setFormData] = useState({ name: '', email: '', subject: '', message: '' });
  const [submitting, setSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    const orderId = searchParams.get('orderId');
    const subjectParam = searchParams.get('subject');
    if (orderId) setFormData(prev => ({ ...prev, subject: `Assistance with Order #${orderId}` }));
    else if (subjectParam) setFormData(prev => ({ ...prev, subject: subjectParam }));
  }, [searchParams]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setSubmitStatus(null);
    try {
      await ContactService.submit(formData);
      setSubmitStatus({ type: 'success', message: 'Thank you for your message! We will get back to you soon.' });
      setFormData({ name: '', email: '', subject: '', message: '' });
    } catch (error: any) {
      setSubmitStatus({ type: 'error', message: error.message || 'Something went wrong. Please try again later.' });
    } finally {
      setSubmitting(false);
    }
  };

  const contactInfo = [
    {
      icon: <MapPin className="h-5 w-5 text-gold" />,
      title: 'Headquarters',
      details: ['9th Floor, Jomer Symphony', 'Chalikkavattom, Ponnurunni North', 'Vyttila']
    },
    {
      icon: <Phone className="h-5 w-5 text-gold" />,
      title: 'Phone Numbers',
      details: ['+91 9895257905', '+91 9895502139']
    },
    {
      icon: <Mail className="h-5 w-5 text-gold" />,
      title: 'Email',
      details: ['support@autobacsindia.com', 'sales@autobacsindia.com']
    },
    {
      icon: <Clock className="h-5 w-5 text-gold" />,
      title: 'Working Hours',
      details: ['Monday - Saturday: 10:00 AM - 6:00 PM', 'Sunday: Closed']
    }
  ];

  const inputClass = 'w-full bg-obsidian-raised border border-hairline text-ink placeholder:text-ink-muted rounded-sm px-4 py-2.5 focus:outline-none focus:border-gold font-display text-sm transition-colors disabled:opacity-50';

  return (
    <div className="min-h-screen bg-obsidian-deep">
      {/* Hero */}
      <section className="bg-obsidian border-b border-hairline">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-20 text-center">
          <p className="text-gold font-display font-bold text-sm uppercase tracking-widest mb-2">Support</p>
          <h1 className="text-4xl font-display font-bold text-ink uppercase tracking-wide mb-4">Contact Us</h1>
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
              <h2 className="text-2xl font-display font-bold text-ink uppercase tracking-wide mb-4">Get In Touch</h2>
              <p className="text-ink/70 font-display mb-8">
                We&apos;d love to hear from you! Whether you have a question about our products, need help with an order,
                or want to explore partnership opportunities, our team is ready to assist you.
              </p>
              <div className="space-y-6">
                {contactInfo.map((item, index) => (
                  <div key={index} className="flex gap-4">
                    <div className="shrink-0 mt-0.5">{item.icon}</div>
                    <div>
                      <h3 className="font-display font-bold text-ink uppercase tracking-wide text-sm mb-1">{item.title}</h3>
                      <ul className="space-y-0.5">
                        {item.details.map((detail, idx) => (
                          <li key={idx} className="text-ink/70 font-display text-sm">{detail}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-10">
                <h3 className="font-display font-bold text-ink uppercase tracking-wide text-sm mb-4">Our Location</h3>
                <div className="bg-obsidian-raised border-2 border-dashed border-hairline rounded-sm w-full h-64 flex items-center justify-center">
                  <span className="text-ink-muted font-display text-sm">Interactive Map Placeholder</span>
                </div>
              </div>
            </div>

            {/* Contact Form */}
            <div>
              <h2 className="text-2xl font-display font-bold text-ink uppercase tracking-wide mb-6">Send Us a Message</h2>

              {submitStatus && (
                <div className={`mb-6 p-4 rounded-sm flex items-start gap-3 ${submitStatus.type === 'success' ? 'bg-green-500/10 border border-green-500/30' : 'bg-red-500/10 border border-red-500/30'}`}>
                  {submitStatus.type === 'success' ? (
                    <CheckCircle className="h-5 w-5 text-green-400 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
                  )}
                  <p className={`text-sm font-display ${submitStatus.type === 'success' ? 'text-green-300' : 'text-red-300'}`}>{submitStatus.message}</p>
                </div>
              )}

              <form onSubmit={handleSubmit} className="bg-obsidian border border-hairline rounded-sm p-6 space-y-4">
                <div>
                  <label htmlFor="name" className="block text-xs font-display font-bold text-ink-muted uppercase tracking-widest mb-1">Full Name</label>
                  <input type="text" id="name" name="name" value={formData.name} onChange={handleChange} required disabled={submitting} className={inputClass} placeholder="Your name" />
                </div>
                <div>
                  <label htmlFor="email" className="block text-xs font-display font-bold text-ink-muted uppercase tracking-widest mb-1">Email Address</label>
                  <input type="email" id="email" name="email" value={formData.email} onChange={handleChange} required disabled={submitting} className={inputClass} placeholder="your.email@example.com" />
                </div>
                <div>
                  <label htmlFor="subject" className="block text-xs font-display font-bold text-ink-muted uppercase tracking-widest mb-1">Subject</label>
                  <input type="text" id="subject" name="subject" value={formData.subject} onChange={handleChange} required disabled={submitting} className={inputClass} placeholder="How can we help?" />
                </div>
                <div>
                  <label htmlFor="message" className="block text-xs font-display font-bold text-ink-muted uppercase tracking-widest mb-1">Message</label>
                  <textarea id="message" name="message" value={formData.message} onChange={handleChange} required disabled={submitting} rows={5} className={inputClass + ' resize-none'} placeholder="Please describe your inquiry..." />
                </div>
                <button type="submit" disabled={submitting} className="w-full bg-gold hover:bg-gold text-obsidian font-display font-bold uppercase tracking-widest py-3 px-4 rounded-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                  {submitting ? (
                    <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-hairline" />Sending...</>
                  ) : (
                    <><Send className="h-4 w-4" />Send Message</>
                  )}
                </button>
              </form>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ strip */}
      <section className="py-16 bg-obsidian border-t border-hairline">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <p className="text-gold font-display font-bold text-sm uppercase tracking-widest mb-2">Quick Answers</p>
            <h2 className="text-2xl font-display font-bold text-ink uppercase tracking-wide">Frequently Asked Questions</h2>
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
                <h3 className="font-display font-bold text-ink uppercase tracking-wide text-sm mb-2">{item.q}</h3>
                <p className="text-ink/70 font-display text-sm">{item.a}</p>
              </div>
            ))}
          </div>
          <div className="text-center mt-10">
            <Link href="/faq" className="inline-block bg-gold hover:bg-gold text-obsidian font-display font-bold uppercase tracking-widest px-6 py-3 rounded-sm transition-colors">
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
