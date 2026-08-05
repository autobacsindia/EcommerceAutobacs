'use client';

/**
 * Contact form → support ticket.
 *
 * Replaces the mailto-only block that stood here after the original form was
 * removed. A mailto link is a dead end operationally: it depends on the visitor
 * having a configured mail client, it produces no record until (and unless) the
 * mail arrives, and it gives the customer no reference to quote. Posting to
 * /support/tickets creates a tracked ticket and returns its reference
 * immediately.
 *
 * The email and phone links stay alongside this — some people genuinely prefer
 * them, and they remain the fallback if the API is unreachable.
 */

import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import apiClient from '@/lib/api';

interface Props {
  /** Prefills the subject, e.g. from /contact?orderId=123 */
  defaultSubject?: string;
  /** Links the ticket to an order when the visitor arrived from an order page. */
  orderId?: string | null;
}

type Status = 'idle' | 'submitting' | 'sent' | 'error';

export default function ContactForm({ defaultSubject = '', orderId = null }: Props) {
  const { user } = useAuth();
  const [status, setStatus] = useState<Status>('idle');
  const [reference, setReference] = useState('');
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: '',
    email: '',
    subject: defaultSubject,
    message: '',
  });

  const set = (key: keyof typeof form) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === 'submitting') return;

    setStatus('submitting');
    setError('');

    try {
      const res = await apiClient.post<{
        success: boolean;
        data: { reference: string };
      }>('/support/tickets', {
        // A signed-in user's account address wins server-side regardless of what
        // is posted, so these fields are only meaningful for guests.
        name: user?.name || form.name,
        email: user?.email || form.email,
        subject: form.subject,
        message: form.message,
        orderId,
      });

      setReference(res?.data?.reference || '');
      setStatus('sent');
      setForm({ name: '', email: '', subject: '', message: '' });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'We could not send your message. Please email us directly.'
      );
      setStatus('error');
    }
  };

  if (status === 'sent') {
    return (
      <div className="bg-obsidian border border-hairline rounded-sm p-6 sm:p-8">
        <h3 className="text-xl font-display font-light text-ink tracking-[-0.01em] mb-3">
          Thanks — we&apos;ve got it
        </h3>
        <p className="text-ink/70 font-display text-sm mb-4">
          {reference ? (
            <>
              Your reference is{' '}
              <strong className="text-gold font-mono">{reference}</strong>. We&apos;ve emailed
              you a confirmation, and you can reply to that email to add anything else.
            </>
          ) : (
            <>We&apos;ve emailed you a confirmation and will reply shortly.</>
          )}
        </p>
        <p className="text-ink-muted font-display text-xs">
          We typically reply within one business day.
        </p>
        <button
          type="button"
          onClick={() => setStatus('idle')}
          className="mt-5 text-gold hover:text-ink font-display text-sm transition-colors"
        >
          Send another message
        </button>
      </div>
    );
  }

  const inputClass =
    'w-full bg-obsidian-raised border border-hairline focus:border-gold rounded-sm px-4 py-3 ' +
    'text-ink font-display text-sm outline-none transition-colors placeholder:text-ink-muted';

  return (
    <form
      onSubmit={onSubmit}
      className="bg-obsidian border border-hairline rounded-sm p-6 sm:p-8 space-y-4"
      noValidate
    >
      {!user && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="contact-name" className="block text-[10px] font-display font-bold uppercase tracking-widest text-ink-muted mb-2">
              Your name
            </label>
            <input
              id="contact-name"
              type="text"
              required
              value={form.name}
              onChange={set('name')}
              className={inputClass}
              placeholder="Jane Doe"
            />
          </div>
          <div>
            <label htmlFor="contact-email" className="block text-[10px] font-display font-bold uppercase tracking-widest text-ink-muted mb-2">
              Email
            </label>
            <input
              id="contact-email"
              type="email"
              required
              value={form.email}
              onChange={set('email')}
              className={inputClass}
              placeholder="you@example.com"
            />
          </div>
        </div>
      )}

      <div>
        <label htmlFor="contact-subject" className="block text-[10px] font-display font-bold uppercase tracking-widest text-ink-muted mb-2">
          Subject
        </label>
        <input
          id="contact-subject"
          type="text"
          value={form.subject}
          onChange={set('subject')}
          className={inputClass}
          placeholder="How can we help?"
        />
      </div>

      <div>
        <label htmlFor="contact-message" className="block text-[10px] font-display font-bold uppercase tracking-widest text-ink-muted mb-2">
          Message
        </label>
        <textarea
          id="contact-message"
          required
          rows={6}
          value={form.message}
          onChange={set('message')}
          className={`${inputClass} resize-y`}
          placeholder="Tell us what you need — include your order number if it relates to an order."
        />
      </div>

      {status === 'error' && (
        <p role="alert" className="text-red-400 font-display text-sm">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={status === 'submitting'}
        className="w-full bg-gold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed text-obsidian font-display font-bold uppercase tracking-widest px-6 py-3 rounded-sm transition-opacity"
      >
        {status === 'submitting' ? 'Sending…' : 'Send message'}
      </button>

      <p className="text-ink-muted font-display text-xs text-center">
        We typically reply within one business day.
      </p>
    </form>
  );
}
