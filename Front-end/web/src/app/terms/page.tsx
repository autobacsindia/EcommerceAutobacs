import type { Metadata } from 'next';
import Link from 'next/link';
import { buildPageMetadata } from '@/lib/pageSeo';
import { CURRENT_TERMS_VERSION } from '@/lib/legal/legalVersions';
import { formatLongDateIST } from '@/lib/datetime';
import { LEGAL_LINKS } from '@/lib/constants';

// Server component on purpose. This page has no hooks and no event handlers, so
// the `'use client'` it used to carry bought nothing — and cost real SEO: a client
// page cannot export generateMetadata, so `/terms` shipped with no title, no
// description and no canonical, and the PageSeo override an admin can already edit
// for this exact path (see Back-end/server/config/staticPages.js) was never read.
export const generateMetadata = (): Promise<Metadata> =>
  buildPageMetadata('/terms', {
    title: 'Terms and Conditions',
    description:
      'The terms and conditions governing your use of the Autobacs India website, and every purchase made through it.',
  });

export default function TermsPage() {
  // Derived from the version, so an edit that bumps the version cannot leave a
  // stale "Last Updated" behind. formatLongDateIST rather than a raw
  // toLocaleDateString: the runtime timezone is UTC on Vercel, which renders the
  // previous day for an IST reader.
  const lastUpdated = formatLongDateIST(`${CURRENT_TERMS_VERSION}T00:00:00+05:30`);

  const sections = [
    {
      heading: '1. Introduction',
      content: (
        <p>
          Welcome to AutoBacs India (&quot;we,&quot; &quot;our,&quot; &quot;us&quot;). These Terms and Conditions govern your access to and use of our
          website located at{' '}
          <Link href="/" className="text-gold hover:text-ink transition-colors">autobacsindia.com</Link>
          {' '}(the &quot;Website&quot;) and our services. By accessing or using our Website, you agree to be bound
          by these Terms and Conditions and our Privacy Policy. If you do not agree to these terms, please do not
          use our Website.
        </p>
      ),
    },
    {
      heading: '2. Services',
      content: (
        <>
          <p className="mb-3">AutoBacs India provides an online platform for the sale of automotive parts, accessories, and related products. Our services include:</p>
          <ul className="space-y-1.5 pl-4">
            {['Online retail of automotive products', 'Product information and specifications', 'Order processing and fulfillment', 'Customer support services', 'Installation service coordination (where available)'].map(item => (
              <li key={item} className="flex items-start gap-2"><span className="text-gold mt-1">—</span><span>{item}</span></li>
            ))}
          </ul>
        </>
      ),
    },
    {
      heading: '3. Eligibility',
      content: <p>You must be at least 18 years old to use our services. By using our Website, you represent and warrant that you are at least 18 years of age and have the legal capacity to enter into these Terms and Conditions.</p>,
    },
    {
      heading: '4. Account Registration',
      content: (
        <>
          <p className="mb-3">To access certain features of our Website, you may be required to create an account. You agree to:</p>
          <ul className="space-y-1.5 pl-4">
            {['Provide accurate, current, and complete information during registration', 'Maintain and promptly update your account information', 'Maintain the security of your password', 'Notify us immediately of any unauthorized use of your account'].map(item => (
              <li key={item} className="flex items-start gap-2"><span className="text-gold mt-1">—</span><span>{item}</span></li>
            ))}
          </ul>
          <p className="mt-3">You are responsible for all activities that occur under your account.</p>
        </>
      ),
    },
    {
      heading: '5. Product Information',
      content: <p>We strive to provide accurate product descriptions, images, and pricing information. However, we do not warrant that product descriptions or other content on our Website are accurate, complete, reliable, current, or error-free. If you receive a product that does not match its description, please contact our customer service team.</p>,
    },
    {
      heading: '6. Pricing and Payment',
      content: (
        <>
          <p className="mb-3">All prices are listed in Indian Rupees (INR) and are inclusive of applicable Goods and Services Tax (GST), unless stated otherwise on the product page. Prices are subject to change without notice. Shipping charges, where applicable, are additional and are shown at checkout or payable on delivery. We reserve the right to refuse or cancel any order for any reason, including but not limited to:</p>
          <ul className="space-y-1.5 pl-4">
            {['Product unavailability', 'Errors in pricing or product information', 'Suspicion of fraudulent activity'].map(item => (
              <li key={item} className="flex items-start gap-2"><span className="text-gold mt-1">—</span><span>{item}</span></li>
            ))}
          </ul>
        </>
      ),
    },
    {
      heading: '7. Orders and Cancellations',
      content: <p>Order acceptance is at our sole discretion. We may refuse to accept any order for any reason. Once an order is placed, you may cancel it within 2 hours by contacting our customer service team. After that period, cancellation depends on the order processing status.</p>,
    },
    {
      heading: '8. Shipping and Delivery',
      content: <p>We offer shipping within India only. Delivery times are estimates and not guaranteed. Risk of loss and title for products purchased pass to you upon our delivery to the carrier.</p>,
    },
    {
      heading: '9. Returns and Refunds',
      content: <p>Our return policy is outlined in our{' '}<Link href={LEGAL_LINKS.returns.href} className="text-gold hover:text-ink transition-colors">{LEGAL_LINKS.returns.label}</Link> policy. Please review it before making a purchase.</p>,
    },
    {
      heading: '10. Intellectual Property',
      content: <p>All content on our Website, including text, graphics, logos, images, and software, is the property of AutoBacs India or its licensors and is protected by intellectual property laws. You may not use any content from our Website without our prior written consent.</p>,
    },
    {
      heading: '11. User Conduct',
      content: (
        <>
          <p className="mb-3">You agree not to:</p>
          <ul className="space-y-1.5 pl-4">
            {['Use our Website for any unlawful purpose', 'Interfere with or disrupt our Website or servers', 'Attempt to gain unauthorized access to our Website', 'Transmit any viruses or malicious code', 'Harvest or collect information about other users'].map(item => (
              <li key={item} className="flex items-start gap-2"><span className="text-gold mt-1">—</span><span>{item}</span></li>
            ))}
          </ul>
        </>
      ),
    },
    {
      heading: '12. Third-Party Links',
      content: <p>Our Website may contain links to third-party websites. We are not responsible for the content or practices of these third-party sites. We encourage you to review the terms and privacy policies of any third-party websites you visit.</p>,
    },
    {
      heading: '13. Disclaimer of Warranties',
      content: <p>Our Website and services are provided &quot;as is&quot; and &quot;as available&quot; without warranties of any kind, either express or implied. We do not warrant that our Website will be uninterrupted or error-free.</p>,
    },
    {
      heading: '14. Limitation of Liability',
      content: <p>To the fullest extent permitted by law, AutoBacs India shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including without limitation, loss of profits, data, use, goodwill, or other intangible losses.</p>,
    },
    {
      heading: '15. Indemnification',
      content: <p>You agree to indemnify and hold harmless AutoBacs India and its affiliates, officers, agents, and employees from any claim or demand, including reasonable attorneys&apos; fees, arising out of your violation of these Terms or your use of our services.</p>,
    },
    {
      heading: '16. Termination',
      content: <p>We may terminate or suspend your access to our services immediately, without prior notice, for any reason whatsoever, including without limitation if you breach these Terms and Conditions.</p>,
    },
    {
      heading: '17. Governing Law and Dispute Resolution',
      content: (
        <>
          <p className="mb-4">
            These Terms and Conditions are governed by and construed in accordance with the laws of India.
            Which of the two sub-sections below applies to a given purchase depends on the buyer category
            selected at checkout — see Section 21 for how that category is determined.
          </p>

          <p className="font-display text-ink mb-2">17A. Individual / Consumer Purchases — Governing Law and Consumer Jurisdiction</p>
          <ul className="space-y-1.5 pl-4 mb-5">
            {[
              'These Terms and any purchase made under them are governed by the laws of India.',
              'Any dispute arising from an Individual / Consumer purchase shall be subject to the jurisdiction of the courts and statutory consumer authorities having jurisdiction in accordance with applicable Indian law.',
              'Nothing in these Terms limits or excludes any statutory right of a consumer to approach the Consumer Disputes Redressal Commission or other competent authority having jurisdiction under applicable law, including the jurisdiction in which the consumer resides or personally works for gain.',
              'We do not require a consumer to submit a dispute to arbitration as a condition of purchase.',
            ].map(item => (
              <li key={item} className="flex items-start gap-2"><span className="text-gold mt-1">—</span><span>{item}</span></li>
            ))}
          </ul>

          <p className="font-display text-ink mb-2">17B. Enterprise / Commercial Purchases — Governing Law, Dispute Resolution and Jurisdiction</p>
          <ul className="space-y-1.5 pl-4">
            {[
              'These Terms and all Enterprise / Commercial purchases made under them are governed by and construed in accordance with the laws of India.',
              'The Buyer agrees that the parties shall first attempt to resolve any dispute arising from or relating to an Enterprise Transaction through good-faith discussions.',
              'If the dispute cannot be resolved through such discussions, it shall be referred to arbitration in accordance with the Arbitration and Conciliation Act, 1996.',
              'The seat and venue of arbitration shall be Ernakulam, Kerala, and the language of the arbitration shall be English.',
              'Subject to the arbitration provision above, the courts at Ernakulam, Kerala shall have exclusive jurisdiction over disputes arising from or relating to the Enterprise Transaction, including applications for interim relief and enforcement of an arbitral award.',
              'By selecting Enterprise / Commercial Buyer and accepting these Enterprise Terms at checkout, the Buyer acknowledges and agrees to the above dispute-resolution and jurisdiction provisions, subject to applicable law.',
            ].map(item => (
              <li key={item} className="flex items-start gap-2"><span className="text-gold mt-1">—</span><span>{item}</span></li>
            ))}
          </ul>
        </>
      ),
    },
    {
      heading: '18. Changes to Terms',
      content: <p>We reserve the right to modify these Terms and Conditions at any time. Any changes will be posted on this page with an updated revision date. Your continued use of our Website after any such changes constitutes your acceptance of the new Terms and Conditions.</p>,
    },
    {
      heading: '19. Contact Information',
      content: (
        <p>
          If you have any questions about these Terms and Conditions, please contact us at AutoBacs India Private Limited —
          Email:{' '}<Link href="mailto:support@autobacsindia.com" className="text-gold hover:text-ink transition-colors">support@autobacsindia.com</Link>
          {' '}— Phone: +91 9895257905
        </p>
      ),
    },
    {
      heading: '20. Entire Agreement',
      content: <p>These Terms and Conditions, together with our Privacy Policy and any other legal notices published by us on our Website, constitute the entire agreement between you and AutoBacs India regarding your use of our Website and services.</p>,
    },
    {
      heading: '21. Enterprise / Commercial Purchases',
      content: (
        <>
          <p className="mb-3">
            An &quot;Enterprise / Commercial Buyer&quot; is a person or entity that selects the Enterprise /
            Commercial buyer category at checkout and supplies a valid GSTIN registered to that person or
            entity. An &quot;Enterprise Transaction&quot; is any order placed on that basis.
          </p>
          <ul className="space-y-1.5 pl-4">
            {[
              'The Enterprise / Commercial category is available only where a valid GSTIN is supplied. A purchase made without one is an Individual / Consumer purchase and is governed by Section 17A.',
              'Selecting the Enterprise / Commercial category is a representation that the goods are being purchased in the course or furtherance of business, and not as a consumer.',
              'Section 17B, including the arbitration provision, applies only to Enterprise Transactions. Every other purchase is governed by Section 17A, and nothing in Section 17B limits a consumer\u2019s statutory rights.',
              'Documentation for an Enterprise Transaction is issued to the legal name and GSTIN supplied at checkout. It is the Buyer\u2019s responsibility to ensure those details are accurate before placing the order.',
              'The document issued on payment is a payment receipt and not a GST tax invoice under the CGST Act, 2017. Input tax credit is not claimable against it. A tax invoice will be issued separately where applicable.',
            ].map(item => (
              <li key={item} className="flex items-start gap-2"><span className="text-gold mt-1">—</span><span>{item}</span></li>
            ))}
          </ul>
        </>
      ),
    },
  ];

  return (
    <div className="min-h-screen bg-obsidian-deep">
      {/* Hero */}
      <section className="bg-obsidian border-b border-hairline">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-20 text-center">
          <p className="font-display text-[10px] uppercase tracking-[0.28em] text-gold mb-2">Legal</p>
          <h1 className="text-4xl font-display font-light text-ink tracking-[-0.01em] mb-4">Terms and Conditions</h1>
          <p className="text-ink/70 font-display max-w-3xl mx-auto">
            Please read these terms and conditions carefully before using our website and services.
          </p>
        </div>
      </section>

      {/* Content */}
      <section className="py-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-obsidian border border-hairline rounded-sm p-8">
            <p className="text-ink-muted font-display text-sm mb-8">
              Last Updated: {lastUpdated} <span className="text-ink-muted/70">(version {CURRENT_TERMS_VERSION})</span>
            </p>

            <div className="space-y-8">
              {sections.map(({ heading, content }, i) => (
                <div key={heading} className={i > 0 ? 'border-t border-hairline pt-8' : ''}>
                  <h2 className="font-display font-light text-ink tracking-[-0.01em] text-lg mb-3">{heading}</h2>
                  <div className="text-ink/70 font-display leading-relaxed">{content}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
