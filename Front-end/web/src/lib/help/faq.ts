/**
 * The site's FAQ, as data.
 *
 * It used to live inline in `app/faq/page.tsx`. The help bot needs the same
 * answers, and a second copy would drift the first time someone edited one —
 * a shipping threshold or a return window stated two different ways on the
 * same site is worse than not stating it at all. One array, two readers.
 */
import { RETURN_POLICY_QUESTION, RETURN_POLICY_SUMMARY } from '@/lib/constants';

export interface Faq {
  question: string;
  answer: string;
}

export interface FaqCategory {
  title: string;
  faqs: Faq[];
}

export const FAQ_CATEGORIES: FaqCategory[] = [
    {
      title: 'Ordering & Payment',
      faqs: [
        { question: 'How do I place an order?', answer: 'You can place an order by browsing our products, adding items to your cart, and proceeding to checkout. During checkout, you\'ll need to provide your shipping information and select a payment method.' },
        { question: 'What payment methods do you accept?', answer: 'We accept all major credit cards (Visa, Mastercard, American Express), debit cards, UPI payments, and Razorpay Wallet. All transactions are secured with industry-standard encryption.' },
        { question: 'Is it safe to use my credit card on your website?', answer: 'Yes, absolutely. We use advanced SSL encryption technology to protect your personal and payment information. Your data is securely transmitted and stored in accordance with industry security standards.' },
        { question: 'Can I change or cancel my order after placing it?', answer: 'You can cancel your order within 2 hours of placing it by contacting our customer service team. After that, cancellation depends on the order processing status. Once an order has shipped, it cannot be cancelled but can be returned according to our return policy.' },
      ]
    },
    {
      title: 'Shipping & Delivery',
      faqs: [
        { question: 'What are your shipping options and delivery times?', answer: 'We offer standard shipping (3-5 business days) and express shipping (1-2 business days) within India. Delivery times may vary based on your location and product availability.' },
        { question: 'Do you ship internationally?', answer: 'Currently, we only ship within India. We are working on expanding our services to international destinations in the near future.' },
        { question: 'How much does shipping cost?', answer: 'Standard shipping is free for orders over ₹2,999. For orders below ₹2,999, a flat shipping fee of ₹199 applies. Express shipping costs ₹399 regardless of order value.' },
        { question: 'How can I track my order?', answer: "Once your order ships, you'll receive a shipping confirmation email with a tracking number. You can also track your order status in your account dashboard under 'My Orders'." },
      ]
    },
    {
      title: 'Returns & Warranty',
      faqs: [
        { question: RETURN_POLICY_QUESTION, answer: RETURN_POLICY_SUMMARY },
        { question: 'How do I return an item?', answer: "To return an item, log into your account, go to 'My Orders', select the order you want to return, and click 'Request Return'. Alternatively, you can contact our customer service team who will guide you through the process." },
        { question: 'How long does it take to process a refund?', answer: 'Once we receive your returned item and verify its condition, refunds are typically processed within 5-7 business days. The time it takes for the refund to appear in your account depends on your payment method.' },
        { question: 'What is covered under warranty?', answer: "Most of our products come with a manufacturer's warranty ranging from 6 months to 2 years depending on the product. Warranty covers manufacturing defects but does not cover damage caused by misuse, accidents, or normal wear and tear." },
      ]
    },
    {
      title: 'Account & Profile',
      faqs: [
        { question: 'How do I create an account?', answer: "Click on the 'Sign Up' button at the top right corner of our website. You'll need to provide your name, email address, and create a password. After registration, you'll receive a confirmation email to verify your account." },
        { question: 'I forgot my password. How can I reset it?', answer: "Click on the 'Login' button, then click 'Forgot Password'. Enter your registered email address and we'll send you a password reset link. The link will expire in 24 hours for security reasons." },
        { question: 'Can I update my account information?', answer: "Yes, you can update your personal information, shipping address, and payment preferences anytime by logging into your account and navigating to the 'Profile' section." },
        { question: 'How do I unsubscribe from marketing emails?', answer: "You can unsubscribe from our marketing emails by clicking the 'Unsubscribe' link at the bottom of any newsletter. You can also manage your email preferences in your account settings." },
      ]
    },
    {
      title: 'Products & Support',
      faqs: [
        { question: 'Are all products genuine?', answer: 'Yes, we guarantee that all products sold on our website are 100% genuine and sourced directly from authorized distributors. We work exclusively with trusted brands and suppliers to ensure product authenticity.' },
        { question: 'How can I be sure a product fits my vehicle?', answer: "Each product page includes detailed compatibility information. You can also use our vehicle selector tool to find products that fit your specific make and model. If you're unsure, our product specialists are available to assist you." },
        { question: 'Do you offer installation services?', answer: "While we don't provide direct installation services, we partner with certified installers across major cities in India. During checkout, you can opt for professional installation services where available in your area." },
        { question: 'Where can I find product manuals and guides?', answer: 'Product manuals and installation guides are available for download on each product page. You can also access our comprehensive knowledge base in the Support section of our website.' },
      ]
    }
  ];

/** Flat list, for search. */
export const ALL_FAQS: Faq[] = FAQ_CATEGORIES.flatMap((c) => c.faqs);
