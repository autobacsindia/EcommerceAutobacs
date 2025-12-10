'use client';

import Link from 'next/link';

export default function TermsPage() {
  const lastUpdated = "December 9, 2025";

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Hero Section */}
      <section className="bg-gradient-to-r from-blue-600 to-blue-800 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-24">
          <div className="text-center">
            <h1 className="text-3xl md:text-4xl font-bold mb-4">Terms and Conditions</h1>
            <p className="text-xl max-w-3xl mx-auto">
              Please read these terms and conditions carefully before using our website and services.
            </p>
          </div>
        </div>
      </section>

      {/* Terms Content */}
      <section className="py-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-white rounded-lg shadow-md p-8">
            <div className="text-sm text-gray-500 mb-8">
              Last Updated: {lastUpdated}
            </div>

            <div className="prose prose-blue max-w-none">
              <h2>1. Introduction</h2>
              <p>
                Welcome to AutoBacs India ("we," "our," "us"). These Terms and Conditions govern your access to and use of our website located at <Link href="/" className="text-blue-600 hover:underline">autobacsindia.com</Link> (the "Website") and our services. By accessing or using our Website, you agree to be bound by these Terms and Conditions and our Privacy Policy. If you do not agree to these terms, please do not use our Website.
              </p>

              <h2>2. Services</h2>
              <p>
                AutoBacs India provides an online platform for the sale of automotive parts, accessories, and related products. Our services include:
              </p>
              <ul>
                <li>Online retail of automotive products</li>
                <li>Product information and specifications</li>
                <li>Order processing and fulfillment</li>
                <li>Customer support services</li>
                <li>Installation service coordination (where available)</li>
              </ul>

              <h2>3. Eligibility</h2>
              <p>
                You must be at least 18 years old to use our services. By using our Website, you represent and warrant that you are at least 18 years of age and have the legal capacity to enter into these Terms and Conditions.
              </p>

              <h2>4. Account Registration</h2>
              <p>
                To access certain features of our Website, you may be required to create an account. You agree to:
              </p>
              <ul>
                <li>Provide accurate, current, and complete information during registration</li>
                <li>Maintain and promptly update your account information</li>
                <li>Maintain the security of your password</li>
                <li>Notify us immediately of any unauthorized use of your account</li>
              </ul>
              <p>
                You are responsible for all activities that occur under your account.
              </p>

              <h2>5. Product Information</h2>
              <p>
                We strive to provide accurate product descriptions, images, and pricing information. However, we do not warrant that product descriptions or other content on our Website are accurate, complete, reliable, current, or error-free. If you receive a product that does not match its description, please contact our customer service team.
              </p>

              <h2>6. Pricing and Payment</h2>
              <p>
                All prices are listed in Indian Rupees (INR) and are subject to change without notice. Prices do not include applicable taxes, which will be added at checkout. We reserve the right to refuse or cancel any order for any reason, including but not limited to:
              </p>
              <ul>
                <li>Product unavailability</li>
                <li>Errors in pricing or product information</li>
                <li>Suspicion of fraudulent activity</li>
              </ul>

              <h2>7. Orders and Cancellations</h2>
              <p>
                Order acceptance is at our sole discretion. We may refuse to accept any order for any reason. Once an order is placed, you may cancel it within 2 hours by contacting our customer service team. After that period, cancellation depends on the order processing status.
              </p>

              <h2>8. Shipping and Delivery</h2>
              <p>
                We offer shipping within India only. Delivery times are estimates and not guaranteed. Risk of loss and title for products purchased pass to you upon our delivery to the carrier.
              </p>

              <h2>9. Returns and Refunds</h2>
              <p>
                Our return policy is outlined in our <Link href="/refund" className="text-blue-600 hover:underline">Refund Policy</Link>. Please review this policy before making a purchase.
              </p>

              <h2>10. Intellectual Property</h2>
              <p>
                All content on our Website, including text, graphics, logos, images, and software, is the property of AutoBacs India or its licensors and is protected by intellectual property laws. You may not use any content from our Website without our prior written consent.
              </p>

              <h2>11. User Conduct</h2>
              <p>
                You agree not to:
              </p>
              <ul>
                <li>Use our Website for any unlawful purpose</li>
                <li>Interfere with or disrupt our Website or servers</li>
                <li>Attempt to gain unauthorized access to our Website</li>
                <li>Transmit any viruses or malicious code</li>
                <li>Harvest or collect information about other users</li>
              </ul>

              <h2>12. Third-Party Links</h2>
              <p>
                Our Website may contain links to third-party websites. We are not responsible for the content or practices of these third-party sites. We encourage you to review the terms and privacy policies of any third-party websites you visit.
              </p>

              <h2>13. Disclaimer of Warranties</h2>
              <p>
                Our Website and services are provided "as is" and "as available" without warranties of any kind, either express or implied. We do not warrant that our Website will be uninterrupted or error-free.
              </p>

              <h2>14. Limitation of Liability</h2>
              <p>
                To the fullest extent permitted by law, AutoBacs India shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including without limitation, loss of profits, data, use, goodwill, or other intangible losses.
              </p>

              <h2>15. Indemnification</h2>
              <p>
                You agree to indemnify and hold harmless AutoBacs India and its affiliates, officers, agents, and employees from any claim or demand, including reasonable attorneys' fees, arising out of your violation of these Terms or your use of our services.
              </p>

              <h2>16. Termination</h2>
              <p>
                We may terminate or suspend your access to our services immediately, without prior notice, for any reason whatsoever, including without limitation if you breach these Terms and Conditions.
              </p>

              <h2>17. Governing Law</h2>
              <p>
                These Terms and Conditions are governed by and construed in accordance with the laws of India, without regard to its conflict of law provisions.
              </p>

              <h2>18. Changes to Terms</h2>
              <p>
                We reserve the right to modify these Terms and Conditions at any time. Any changes will be posted on this page with an updated revision date. Your continued use of our Website after any such changes constitutes your acceptance of the new Terms and Conditions.
              </p>

              <h2>19. Contact Information</h2>
              <p>
                If you have any questions about these Terms and Conditions, please contact us at:
              </p>
              <p>
                AutoBacs India Private Limited<br />
                Email: <Link href="mailto:support@autobacsindia.com" className="text-blue-600 hover:underline">support@autobacsindia.com</Link><br />
                Phone: +91 9895257905
              </p>

              <h2>20. Entire Agreement</h2>
              <p>
                These Terms and Conditions, together with our Privacy Policy and any other legal notices published by us on our Website, constitute the entire agreement between you and AutoBacs India regarding your use of our Website and services.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}