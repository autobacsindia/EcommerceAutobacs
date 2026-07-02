'use client';

import Link from 'next/link';

export default function TermsPage() {
  const lastUpdated = 'December 9, 2025';

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
          <p className="mb-3">All prices are listed in Indian Rupees (INR) and are subject to change without notice. Prices do not include applicable taxes, which will be added at checkout. We reserve the right to refuse or cancel any order for any reason, including but not limited to:</p>
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
      content: <p>Our return policy is outlined in our{' '}<Link href="/returns" className="text-gold hover:text-ink transition-colors">Refund Policy</Link>. Please review this policy before making a purchase.</p>,
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
      heading: '17. Governing Law',
      content: <p>These Terms and Conditions are governed by and construed in accordance with the laws of India, without regard to its conflict of law provisions.</p>,
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
            <p className="text-ink-muted font-display text-sm mb-8">Last Updated: {lastUpdated}</p>

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
