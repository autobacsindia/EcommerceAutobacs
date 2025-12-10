'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

export default function FAQPage() {
  const faqCategories = [
    {
      title: "Ordering & Payment",
      faqs: [
        {
          question: "How do I place an order?",
          answer: "You can place an order by browsing our products, adding items to your cart, and proceeding to checkout. During checkout, you'll need to provide your shipping information and select a payment method."
        },
        {
          question: "What payment methods do you accept?",
          answer: "We accept all major credit cards (Visa, Mastercard, American Express), debit cards, UPI payments, and Razorpay Wallet. All transactions are secured with industry-standard encryption."
        },
        {
          question: "Is it safe to use my credit card on your website?",
          answer: "Yes, absolutely. We use advanced SSL encryption technology to protect your personal and payment information. Your data is securely transmitted and stored in accordance with industry security standards."
        },
        {
          question: "Can I change or cancel my order after placing it?",
          answer: "You can cancel your order within 2 hours of placing it by contacting our customer service team. After that, cancellation depends on the order processing status. Once an order has shipped, it cannot be cancelled but can be returned according to our return policy."
        }
      ]
    },
    {
      title: "Shipping & Delivery",
      faqs: [
        {
          question: "What are your shipping options and delivery times?",
          answer: "We offer standard shipping (3-5 business days) and express shipping (1-2 business days) within India. Delivery times may vary based on your location and product availability."
        },
        {
          question: "Do you ship internationally?",
          answer: "Currently, we only ship within India. We are working on expanding our services to international destinations in the near future."
        },
        {
          question: "How much does shipping cost?",
          answer: "Standard shipping is free for orders over ₹2,999. For orders below ₹2,999, a flat shipping fee of ₹199 applies. Express shipping costs ₹399 regardless of order value."
        },
        {
          question: "How can I track my order?",
          answer: "Once your order ships, you'll receive a shipping confirmation email with a tracking number. You can also track your order status in your account dashboard under 'My Orders'."
        }
      ]
    },
    {
      title: "Returns & Warranty",
      faqs: [
        {
          question: "What is your return policy?",
          answer: "We offer a 30-day return policy for unused items in their original packaging. Items must be in resalable condition. Some exceptions apply for certain product categories. Please contact our support team to initiate a return."
        },
        {
          question: "How do I return an item?",
          answer: "To return an item, log into your account, go to 'My Orders', select the order you want to return, and click 'Request Return'. Alternatively, you can contact our customer service team who will guide you through the process."
        },
        {
          question: "How long does it take to process a refund?",
          answer: "Once we receive your returned item and verify its condition, refunds are typically processed within 5-7 business days. The time it takes for the refund to appear in your account depends on your payment method."
        },
        {
          question: "What is covered under warranty?",
          answer: "Most of our products come with a manufacturer's warranty ranging from 6 months to 2 years depending on the product. Warranty covers manufacturing defects but does not cover damage caused by misuse, accidents, or normal wear and tear."
        }
      ]
    },
    {
      title: "Account & Profile",
      faqs: [
        {
          question: "How do I create an account?",
          answer: "Click on the 'Sign Up' button at the top right corner of our website. You'll need to provide your name, email address, and create a password. After registration, you'll receive a confirmation email to verify your account."
        },
        {
          question: "I forgot my password. How can I reset it?",
          answer: "Click on the 'Login' button, then click 'Forgot Password'. Enter your registered email address and we'll send you a password reset link. The link will expire in 24 hours for security reasons."
        },
        {
          question: "Can I update my account information?",
          answer: "Yes, you can update your personal information, shipping address, and payment preferences anytime by logging into your account and navigating to the 'Profile' section."
        },
        {
          question: "How do I unsubscribe from marketing emails?",
          answer: "You can unsubscribe from our marketing emails by clicking the 'Unsubscribe' link at the bottom of any newsletter. You can also manage your email preferences in your account settings."
        }
      ]
    },
    {
      title: "Products & Support",
      faqs: [
        {
          question: "Are all products genuine?",
          answer: "Yes, we guarantee that all products sold on our website are 100% genuine and sourced directly from authorized distributors. We work exclusively with trusted brands and suppliers to ensure product authenticity."
        },
        {
          question: "How can I be sure a product fits my vehicle?",
          answer: "Each product page includes detailed compatibility information. You can also use our vehicle selector tool to find products that fit your specific make and model. If you're unsure, our product specialists are available to assist you."
        },
        {
          question: "Do you offer installation services?",
          answer: "While we don't provide direct installation services, we partner with certified installers across major cities in India. During checkout, you can opt for professional installation services where available in your area."
        },
        {
          question: "Where can I find product manuals and guides?",
          answer: "Product manuals and installation guides are available for download on each product page. You can also access our comprehensive knowledge base in the Support section of our website."
        }
      ]
    }
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Hero Section */}
      <section className="bg-gradient-to-r from-blue-600 to-blue-800 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-24">
          <div className="text-center">
            <h1 className="text-3xl md:text-4xl font-bold mb-4">Frequently Asked Questions</h1>
            <p className="text-xl max-w-3xl mx-auto">
              Find answers to common questions about our products, services, and policies.
            </p>
          </div>
        </div>
      </section>

      {/* FAQ Content */}
      <section className="py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-12 text-center">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">How can we help you?</h2>
            <p className="text-gray-600 max-w-2xl mx-auto">
              Browse our FAQ categories below or contact our support team if you can't find what you're looking for.
            </p>
          </div>

          <div className="space-y-8">
            {faqCategories.map((category, categoryIndex) => (
              <div key={categoryIndex} className="bg-white rounded-lg shadow-md overflow-hidden">
                <div className="bg-gray-100 px-6 py-4">
                  <h3 className="text-xl font-semibold text-gray-900">{category.title}</h3>
                </div>
                <div className="p-6">
                  <div className="space-y-6">
                    {category.faqs.map((faq, faqIndex) => (
                      <div key={faqIndex} className="border-b border-gray-200 pb-6 last:border-b-0 last:pb-0">
                        <h4 className="text-lg font-medium text-gray-900 mb-2">{faq.question}</h4>
                        <p className="text-gray-600">{faq.answer}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Still Need Help */}
          <div className="mt-16 bg-blue-50 rounded-lg p-8 text-center">
            <h3 className="text-2xl font-bold text-gray-900 mb-4">Still need help?</h3>
            <p className="text-gray-600 mb-6 max-w-2xl mx-auto">
              Can't find the answer you're looking for? Our customer support team is here to help you.
            </p>
            <div className="flex flex-col sm:flex-row justify-center gap-4">
              <Link 
                href="/contact" 
                className="inline-flex items-center justify-center px-6 py-3 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 transition-colors"
              >
                Contact Us
                <ChevronRight className="ml-2 h-5 w-5" />
              </Link>
              <Link 
                href="/support/chat" 
                className="inline-flex items-center justify-center px-6 py-3 bg-white text-blue-600 font-medium rounded-md border border-blue-600 hover:bg-blue-50 transition-colors"
              >
                Live Chat
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}