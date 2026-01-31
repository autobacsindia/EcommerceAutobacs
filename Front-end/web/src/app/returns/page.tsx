'use client';

import Link from 'next/link';

export default function ReturnsPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Hero Section */}
      <section className="bg-gradient-to-r from-blue-600 to-blue-800 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-24">
          <div className="text-center">
            <h1 className="text-3xl md:text-4xl font-bold mb-4">Return and Exchange Policy</h1>
            <p className="text-xl max-w-3xl mx-auto">
              At Autobacs India, we strive to ensure customer satisfaction. Please read our policy carefully before making a purchase.
            </p>
          </div>
        </div>
      </section>

      {/* Content Section */}
      <section className="py-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-white rounded-lg shadow-md p-8">
            <div className="prose prose-blue max-w-none">
              
              {/* 1. Return Policy */}
              <h2>1. Return Policy</h2>
              
              <h3>Eligibility for Returns</h3>
              <p>
                You may request a return within <strong>7 calendar days</strong> from the date of receiving your order. To be eligible for a return:
              </p>
              <ul>
                <li>The item must be <strong>unused, undamaged, and in its original condition</strong> as received.</li>
                <li>The item must be returned <strong>in its original packaging</strong>, including all accessories, manuals, and tags.</li>
                <li>Returns will <strong>not</strong> be accepted for products that have been installed, used, or damaged after delivery.</li>
              </ul>

              <h3>Non-Returnable Items</h3>
              <p>The following items <strong>cannot</strong> be returned:</p>
              <ul>
                <li>Custom-made or special-order items.</li>
                <li>Electrical and electronic components once installed or tested.</li>
                <li>Clearance sale or discounted items marked as <strong>non-returnable</strong>.</li>
              </ul>

              <h3>Refund Policy</h3>
              <p>
                We do not offer direct refunds. Instead, we provide exchanges or store credit for eligible return cases.
              </p>
              <ul>
                <li>Store credit will be issued for valid return cases and can be used for future purchases within <strong>6 months</strong> from the date of issue.</li>
                <li>Once the returned product reaches our warehouse, a quality inspection will be conducted. After successful verification, the refund or store credit will be processed within <strong>7 to 14 business days</strong>.</li>
              </ul>

              <hr className="my-8" />

              {/* 2. Exchange Policy */}
              <h2>2. Exchange Policy</h2>
              
              <h3>Eligibility for Exchange</h3>
              <p>
                You may request an exchange within <strong>7 days</strong> of receiving your order if:
              </p>
              <ul>
                <li>The item is <strong>defective</strong> or has a <strong>manufacturing fault</strong>.</li>
                <li>You received an <strong>incorrect item</strong>.</li>
                <li>The item was <strong>damaged during transit</strong> (requires photographic proof at the time of unboxing).</li>
              </ul>

              <h3>Exchange Process</h3>
              <ol>
                <li><strong>Initiate a Request</strong> – Contact our customer support at <a href="mailto:info@autobacsindia.com">info@autobacsindia.com</a> within <strong>7 days</strong> of receiving the product.</li>
                <li><strong>Verification</strong> – Our team will assess the request and provide return instructions if the exchange is approved.</li>
                <li><strong>Return the Item</strong> – Send the item back in its <strong>original condition and packaging</strong>. Shipping costs for returning items may be covered by us if the fault is from our side (wrong item or defective product).</li>
                <li><strong>Receive the Replacement</strong> – Once we receive and inspect the returned item, we will ship the replacement product.</li>
              </ol>

              <hr className="my-8" />

              {/* 3. Unclaimed Products Terms */}
              <h2>3. Unclaimed Products Terms</h2>
              <p>
                This section outlines the terms and procedures regarding products that remain uncollected by the customer after a purchase, service, repair, or delivery notification.
              </p>

              <h3>Definition of Unclaimed Products</h3>
              <p>
                A product is considered <strong>unclaimed</strong> if it is not collected within <strong>30 days</strong> after the customer has been notified—via phone, email, SMS, or any other provided means of contact—that the item is ready for pickup or delivery.
              </p>

              <h3>Storage and Administration Fees</h3>
              <p>
                If a product remains unclaimed for more than <strong>30 days</strong> following customer notification, we reserve the right to apply <strong>storage and administrative fees</strong>. These charges cover the cost of storing and managing the product during the extended holding period.
              </p>
              <ul>
                <li>The customer will be informed of the exact fees applicable before collection.</li>
                <li>The final day to collect the product without incurring charges will be considered the <strong>30th day</strong> after the last notice was sent.</li>
              </ul>

              <h3>Final Collection Notice</h3>
              <p>
                If the product remains unclaimed after <strong>60 days</strong>, a <strong>final written notice</strong> will be issued using the most recent contact details provided by the customer. The customer will then be granted an additional <strong>14 days</strong> to arrange collection and pay any outstanding storage or handling fees.
              </p>

              <h3>Ownership Forfeiture and Disposal</h3>
              <p>
                If the product is still unclaimed <strong>after 74 days</strong> (60 days + 14-day grace period) and we receive no communication from the customer, the item may be considered <strong>forfeited</strong>. In such cases, we reserve the right to:
              </p>
              <ul>
                <li><strong>Dispose of, sell, or repurpose</strong> the product to recover incurred costs.</li>
                <li><strong>Retain all proceeds</strong> from any sale as compensation for storage, handling, and administrative fees.</li>
              </ul>

              <h3>Reclaiming an Unclaimed Product</h3>
              <p>To reclaim an unclaimed product, the customer must:</p>
              <ul>
                <li>Present a <strong>valid form of identification</strong> and <strong>proof of ownership</strong> (e.g., purchase receipt or service invoice).</li>
                <li>Settle all <strong>applicable charges</strong>, including any outstanding storage, service, or parts fees.</li>
                <li>Collect the item <strong>during standard business hours</strong> as notified.</li>
              </ul>

              <h3>No Liability for Loss After Forfeiture</h3>
              <p>
                We accept <strong>no liability</strong> for any loss, damage, or inconvenience caused by the forfeiture or disposal of unclaimed products, provided that we have made reasonable efforts to contact the customer as outlined above.
              </p>

              <hr className="my-8" />

              {/* Shipping and Costs */}
              <h2>Shipping and Costs</h2>
              <ul>
                <li>Customers are responsible for return shipping costs unless the return is due to a defective or incorrect item.</li>
                <li>If a replacement is unavailable, we may provide store credit for future purchases.</li>
                <li>Items returned without prior approval will not be accepted.</li>
              </ul>

              <hr className="my-8" />

              {/* Contact Us */}
              <h2>Contact Us</h2>
              <p>
                For any questions or assistance regarding returns and exchanges, please contact us:
              </p>
              <p>
                <strong>Email:</strong> <a href="mailto:info@autobacsindia.com">info@autobacsindia.com</a>
              </p>
              <p className="text-sm text-gray-500 mt-8">
                By purchasing from Autobacs India, you agree to this return and exchange policy. We comply with <strong>The Consumer Protection Act, 2019</strong> and other applicable Indian laws governing consumer rights and product returns.
              </p>

            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
