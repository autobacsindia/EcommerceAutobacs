import React from 'react';
import Link from 'next/link';

export default function ConditionsPage() {
  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">Conditions of Use</h1>
      <div className="prose max-w-none">
        <p>
          Welcome to AutoBacs India. By accessing or using our website and services, you agree to the
          following conditions. Please read them carefully before placing an order or creating an account.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-4">1. Acceptance of Terms</h2>
        <p>
          Your use of the AutoBacs India website constitutes your acceptance of these Conditions of Use and
          our <Link href="/privacy" className="text-gold hover:underline">Privacy Policy</Link>. If you
          do not agree, please discontinue use of the site.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-4">2. Use of the Site</h2>
        <p>
          You may use this site for personal, non-commercial purposes only. You agree not to misuse the
          site, interfere with its operation, or attempt to gain unauthorised access to any part of it.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-4">3. Orders and Payments</h2>
        <p>
          All prices are listed in Indian Rupees (INR) and are inclusive of applicable taxes unless stated
          otherwise. We reserve the right to refuse or cancel any order at our discretion.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-4">4. Returns and Refunds</h2>
        <p>
          Items may be returned within 7 days of delivery in original, unused condition. Please visit our{' '}
          <Link href="/returns" className="text-gold hover:underline">Returns page</Link> for full details.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-4">5. Limitation of Liability</h2>
        <p>
          AutoBacs India shall not be liable for any indirect, incidental, or consequential damages arising
          from use of our website or products beyond the amount paid for the order in question.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-4">6. Changes to These Conditions</h2>
        <p>
          We may update these Conditions of Use from time to time. Continued use of the site after any
          changes constitutes your acceptance of the revised conditions.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-4">7. Contact Us</h2>
        <p>
          For questions about these conditions, please contact us at{' '}
          <Link href="mailto:support@autobacsindia.com" className="text-gold hover:underline">
            support@autobacsindia.com
          </Link>{' '}
          or call +91 9895257905.
        </p>
      </div>
    </div>
  );
}
