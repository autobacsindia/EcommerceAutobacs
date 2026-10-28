import Link from 'next/link';
import { ArrowRight, ChevronDown, ChevronRight } from 'lucide-react';
import { FAQ_CATEGORIES, type FaqLink } from '@/lib/help/faq';
import { whatsappLink } from '@/lib/contactInfo';
import { serializeJsonLd } from '@/lib/jsonLd';
import StorePageHeader from '@/components/store/StorePageHeader';

/**
 * /faq — every question in lib/help/faq.ts, grouped, with a way out of each.
 *
 * A server component: the questions are plain HTML <details>, so they open and
 * close with no JavaScript, and every answer is in the first response for
 * crawlers and screen readers. Metadata comes from ./layout.tsx (admin-managed
 * via /admin/seo, per the config-driven SEO system).
 *
 * The FAQPage JSON-LD is built from the same array the page renders, so Google
 * is only ever told what a visitor can read here.
 */
const FAQ_SCHEMA = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQ_CATEGORIES.flatMap((c) => c.faqs).map((f) => ({
    '@type': 'Question',
    name: f.question,
    acceptedAnswer: { '@type': 'Answer', text: f.answer },
  })),
};

function AnswerLink({ link }: { link: FaqLink }) {
  const cls = 'inline-flex items-center gap-1.5 rounded-full border border-gold/40 bg-gold/10 px-3.5 py-1.5 font-display text-[13px] font-semibold text-gold transition-colors hover:bg-gold/20';
  const inner = <>{link.label}<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></>;
  return /^https?:/.test(link.href)
    ? <a href={link.href} target="_blank" rel="noopener noreferrer" className={cls}>{inner}</a>
    : <Link href={link.href} className={cls}>{inner}</Link>;
}

export default function FAQPage() {
  return (
    <div className="sp sh-theme">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(FAQ_SCHEMA) }} />
      <StorePageHeader
        crumbs={[{ label: 'Frequently Asked Questions' }]}
        title="Frequently Asked Questions"
        subtitle={<>Quick answers about orders, delivery, returns, fitment and your account.</>}
      />

      <section className="py-10 sm:py-14">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          {/* Jump to a section. */}
          <nav aria-label="FAQ sections" className="mb-10 flex flex-wrap justify-center gap-2">
            {FAQ_CATEGORIES.map((c) => (
              <a
                key={c.id}
                href={`#${c.id}`}
                className="rounded-full border border-hairline bg-obsidian px-4 py-2 font-display text-[13px] font-semibold text-ink transition-colors hover:border-gold hover:text-gold"
              >
                {c.title}
              </a>
            ))}
          </nav>

          <div className="space-y-10">
            {FAQ_CATEGORIES.map((c) => (
              <section key={c.id} id={c.id} aria-labelledby={`${c.id}-title`} className="scroll-mt-32">
                <h2 id={`${c.id}-title`} className="mb-4 font-display text-xl font-bold tracking-[-0.01em] text-ink">{c.title}</h2>
                <div className="divide-y divide-hairline overflow-hidden rounded-xl border border-hairline bg-obsidian">
                  {c.faqs.map((f) => (
                    <details key={f.question} className="group">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 font-display text-[15px] font-semibold text-ink transition-colors hover:bg-obsidian-raised [&::-webkit-details-marker]:hidden">
                        {f.question}
                        <ChevronDown className="h-5 w-5 shrink-0 text-ink-muted transition-transform group-open:rotate-180" aria-hidden="true" />
                      </summary>
                      <div className="px-5 pb-5">
                        <p className="font-display text-sm leading-relaxed text-ink/75">{f.answer}</p>
                        {!!f.links?.length && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {f.links.map((l) => <AnswerLink key={l.href} link={l} />)}
                          </div>
                        )}
                      </div>
                    </details>
                  ))}
                </div>
              </section>
            ))}
          </div>

          {/* Still Need Help */}
          <div className="mt-12 rounded-lg border border-gold/30 bg-gold/10 p-8 text-center">
            <h2 className="mb-3 font-display text-xl font-bold tracking-[-0.01em] text-ink">Still need help?</h2>
            <p className="mx-auto mb-6 max-w-xl font-display text-ink/70">
              Can&apos;t find the answer you&apos;re looking for? Our team is here Monday to Saturday, 10 AM to 6 PM.
            </p>
            <div className="flex flex-col justify-center gap-4 sm:flex-row">
              <Link href="/contact" className="inline-flex items-center justify-center gap-2 rounded-full bg-gold px-6 py-3 font-display font-bold text-white transition-colors hover:opacity-90">
                Contact Us
                <ChevronRight className="h-4 w-4" />
              </Link>
              {/* There is no /support/chat page — WhatsApp is where a person actually answers. */}
              <a href={whatsappLink('Hi, I have a question that the FAQ did not answer.')} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center rounded-full border border-hairline bg-obsidian-raised px-6 py-3 font-display font-bold text-ink/70 transition-colors hover:text-ink">
                Chat on WhatsApp
              </a>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
