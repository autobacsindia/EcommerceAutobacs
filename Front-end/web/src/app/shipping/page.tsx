'use client';

import Link from 'next/link';
import { Truck, Clock, MapPin, CreditCard } from 'lucide-react';

export default function ShippingPage() {
  const lastUpdated = "December 9, 2025";

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Hero Section */}
      <section className="bg-gradient-to-r from-blue-600 to-blue-800 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-24">
          <div className="text-center">
            <h1 className="text-3xl md:text-4xl font-bold mb-4">Shipping & Delivery</h1>
            <p className="text-xl max-w-3xl mx-auto">
              Learn about our shipping options, delivery times, and policies to ensure your order arrives safely and on time.
            </p>
          </div>
        </div>
      </section>

      {/* Shipping Content */}
      <section className="py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-white rounded-lg shadow-md p-8 mb-8">
            <div className="text-sm text-gray-500 mb-8">
              Last Updated: {lastUpdated}
            </div>

            <div className="prose prose-blue max-w-none">
              <h2>Our Shipping Promise</h2>
              <p>
                At AutoBacs India, we're committed to delivering your automotive parts and accessories quickly and securely. We understand that getting the right parts on time is crucial for your projects, which is why we've partnered with reliable carriers to ensure your order arrives in perfect condition.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 my-8">
                <div className="bg-blue-50 p-6 rounded-lg">
                  <Truck className="h-10 w-10 text-blue-600 mb-4" />
                  <h3 className="text-xl font-semibold mb-2">Nationwide Coverage</h3>
                  <p className="text-gray-600">
                    We ship to all major cities and towns across India, ensuring that automotive enthusiasts everywhere can access our premium parts.
                  </p>
                </div>
                
                <div className="bg-blue-50 p-6 rounded-lg">
                  <Clock className="h-10 w-10 text-blue-600 mb-4" />
                  <h3 className="text-xl font-semibold mb-2">Fast Delivery</h3>
                  <p className="text-gray-600">
                    Our standard delivery takes 3-5 business days, with express options available for urgent needs.
                  </p>
                </div>
              </div>

              <h2>Shipping Options</h2>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Service</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Delivery Time</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Cost</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    <tr>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">Standard Shipping</div>
                        <div className="text-sm text-gray-500">Ground delivery</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">3-5 business days</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        <div>Free for orders over ₹2,999</div>
                        <div>₹199 for orders under ₹2,999</div>
                      </td>
                    </tr>
                    <tr>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">Express Shipping</div>
                        <div className="text-sm text-gray-500">Priority delivery</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">1-2 business days</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">₹399 (flat rate)</td>
                    </tr>
                    <tr>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">Same-Day Delivery</div>
                        <div className="text-sm text-gray-500">Metro areas only</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">Same day (before 4 PM cutoff)</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">₹599 (flat rate)</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <h2>Delivery Areas</h2>
              <p>
                We currently ship to all major metropolitan areas and towns across India. For remote locations, delivery times may be extended by 1-2 business days. During checkout, you can enter your pin code to see if same-day or express delivery is available in your area.
              </p>

              <h3>Major Metro Areas Covered:</h3>
              <ul>
                <li>Delhi NCR</li>
                <li>Mumbai</li>
                <li>Bengaluru</li>
                <li>Chennai</li>
                <li>Kolkata</li>
                <li>Hyderabad</li>
                <li>Pune</li>
                <li>Ahmedabad</li>
                <li>Jaipur</li>
                <li>Chandigarh</li>
              </ul>

              <h2>Order Processing</h2>
              <p>
                Orders are typically processed within 1-2 business days. Orders placed after 2 PM will be processed the next business day. Processing time does not include weekends or holidays.
              </p>

              <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 my-6">
                <div className="flex">
                  <div className="flex-shrink-0">
                    <CreditCard className="h-5 w-5 text-yellow-400" />
                  </div>
                  <div className="ml-3">
                    <p className="text-sm text-yellow-700">
                      <strong>Note:</strong> Pre-orders and backordered items may have different shipping timelines. You'll receive a separate notification with estimated delivery dates for these items.
                    </p>
                  </div>
                </div>
              </div>

              <h2>Tracking Your Order</h2>
              <p>
                Once your order ships, you'll receive a shipping confirmation email with tracking information. You can also track your order status in your account dashboard under "My Orders". Tracking updates are typically available within 24 hours of shipment.
              </p>

              <h2>Delivery Process</h2>
              <ol>
                <li><strong>Order Confirmation:</strong> Receive an email confirming your order</li>
                <li><strong>Processing:</strong> Our team prepares your order (1-2 business days)</li>
                <li><strong>Shipment:</strong> Order is handed to our shipping partner</li>
                <li><strong>In Transit:</strong> Track your package using the provided tracking number</li>
                <li><strong>Out for Delivery:</strong> Package is on its way to your address</li>
                <li><strong>Delivered:</strong> Package is delivered to your specified location</li>
              </ol>

              <h2>Special Delivery Instructions</h2>
              <p>
                During checkout, you can add special delivery instructions for our shipping partners. This is especially helpful if:
              </p>
              <ul>
                <li>You're not home during typical delivery hours</li>
                <li>Your address is difficult to find</li>
                <li>You want the package left in a specific location</li>
                <li>You need delivery to an alternate address</li>
              </ul>

              <h2>Undelivered Packages</h2>
              <p>
                If a delivery attempt fails, our shipping partner will:
              </p>
              <ol>
                <li>Leave a notice at your address with re-delivery information</li>
                <li>Attempt a second delivery within 2 business days</li>
                <li>If the second attempt fails, the package will be held at the local facility for 7 days</li>
                <li>After 7 days, unclaimed packages will be returned to us and a refund will be issued minus return shipping costs</li>
              </ol>

              <h2>International Shipping</h2>
              <p>
                Currently, we only ship within India. We are working on expanding our services to international destinations in the near future. Please check back for updates or contact our customer service team for more information.
              </p>

              <h2>Shipping Restrictions</h2>
              <p>
                Some products may have shipping restrictions due to size, weight, or hazardous material considerations. These restrictions will be noted on the product page. If you have questions about shipping a specific item, please contact our customer service team.
              </p>

              <h2>Need Help?</h2>
              <p>
                If you have any questions about our shipping policies or need assistance with your order, please don't hesitate to contact us:
              </p>
              <p>
                AutoBacs India Customer Service<br />
                Email: <Link href="mailto:support@autobacsindia.com" className="text-blue-600 hover:underline">support@autobacsindia.com</Link><br />
                Phone: +91 9895257905<br />
                Hours: Monday - Saturday, 9:00 AM - 6:00 PM IST
              </p>

              <div className="mt-8 p-6 bg-blue-50 rounded-lg">
                <h3 className="text-lg font-semibold mb-2">Related Information</h3>
                <p className="mb-4">
                  For information about returns and exchanges, please see our <Link href="/returns" className="text-blue-600 hover:underline">Return Policy</Link>.
                </p>
                <p>
                  For questions about order status, visit our <Link href="/faq" className="text-blue-600 hover:underline">FAQ page</Link> or contact our support team.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}