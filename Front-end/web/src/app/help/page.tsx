import React from 'react';
import Link from 'next/link';

export default function HelpPage() {
  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">Help Centre</h1>
      <div className="prose max-w-none">
        <p>
          Welcome to AutoBacs India Support. Find answers to common questions below, or reach out to our
          team directly.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-4">Ordering</h2>
        <p>
          Browse products using the search bar or category menus. Add items to your cart and proceed to
          checkout. You will receive a confirmation email once your order is placed.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-4">Payments</h2>
        <p>
          We accept UPI, debit/credit cards, and net banking via Razorpay. All transactions are
          encrypted and secure. Cash on delivery is not currently available.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-4">Shipping &amp; Delivery</h2>
        <p>
          Orders are typically dispatched within 1–2 business days. Delivery times vary by location.
          You can track your order from the{' '}
          <Link href="/orders" className="text-blue-600 hover:underline">My Orders</Link> page.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-4">Returns &amp; Refunds</h2>
        <p>
          Items can be returned within 7 days of delivery if unused and in original packaging. Visit our{' '}
          <Link href="/returns" className="text-blue-600 hover:underline">Returns page</Link> to initiate
          a return request.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-4">Account &amp; Password</h2>
        <p>
          If you have forgotten your password, use the{' '}
          <Link href="/forgot-password" className="text-blue-600 hover:underline">Forgot Password</Link>{' '}
          link on the login page to reset it via email.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-4">Vehicle Compatibility</h2>
        <p>
          Use the vehicle selector on any product page to filter parts that fit your specific make,
          model, and year. Our catalogue is regularly updated to ensure accuracy.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-4">Contact Support</h2>
        <p>
          Our support team is available Monday – Saturday, 9 AM – 6 PM IST.
        </p>
        <ul>
          <li>
            Email:{' '}
            <Link href="mailto:support@autobacsindia.com" className="text-blue-600 hover:underline">
              support@autobacsindia.com
            </Link>
          </li>
          <li>Phone: +91 9895257905</li>
          <li>
            Contact form:{' '}
            <Link href="/contact" className="text-blue-600 hover:underline">
              Contact Us
            </Link>
          </li>
        </ul>
      </div>
    </div>
  );
}
