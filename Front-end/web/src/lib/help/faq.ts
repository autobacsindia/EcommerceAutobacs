/**
 * The site's FAQ, as data.
 *
 * Three readers share it: the /faq page, its FAQPage JSON-LD, and the help bot
 * (lib/help/intents.ts, which finds answers by a fragment of the QUESTION — keep
 * those wordings when editing). A shipping threshold or a return window stated
 * two ways on one site is worse than not stating it at all, so every answer
 * here repeats only what another page or the checkout already commits to:
 *
 *   • cancellation  — app/terms ("7. Orders and Cancellations")
 *   • refund timing — app/returns (inspection, then 5–9 business days)
 *   • return policy — RETURN_POLICY_SUMMARY (lib/constants.ts)
 *   • delivery      — free on every order (checkout sends shippingCost: 0);
 *                     standard times as app/shipping states them
 *
 * `links` send the shopper to the page that does the thing the answer
 * describes — the FAQ is a signpost, not a dead end.
 */
import { RETURN_POLICY_QUESTION, RETURN_POLICY_SUMMARY } from '@/lib/constants';
import { SUPPORT_EMAIL, SUPPORT_PHONE_DISPLAY } from '@/lib/contactInfo';

export interface FaqLink {
  label: string;
  /** A site path, or an absolute URL (opens in a new tab). */
  href: string;
}

export interface Faq {
  question: string;
  answer: string;
  links?: FaqLink[];
}

export interface FaqCategory {
  /** Anchor on /faq (`/faq#shipping`), so other pages and the bot can link a section. */
  id: string;
  title: string;
  faqs: Faq[];
}

export const FAQ_CATEGORIES: FaqCategory[] = [
  {
    id: 'ordering',
    title: 'Ordering & Payment',
    faqs: [
      {
        question: 'How do I place an order?',
        answer: 'Find your part using search or "Select your vehicle", add it to your cart and go to checkout. Enter your delivery address, pay securely, and you will get an email confirming your order.',
        links: [{ label: 'Browse products', href: '/products' }, { label: 'Go to cart', href: '/cart' }],
      },
      {
        question: 'What payment methods do you accept?',
        answer: 'Credit and debit cards, UPI, net banking and EMI — all through Razorpay\'s secure checkout. If our sales team creates your order, you can also pay by bank transfer or UPI QR.',
      },
      {
        question: 'Is it safe to use my credit card on your website?',
        answer: 'Yes. Payments are handled entirely by Razorpay, a PCI-DSS compliant payment gateway. Your card details go straight to Razorpay — we never see or store them.',
      },
      {
        question: 'Can I buy on EMI?',
        answer: 'Yes. Product pages show EMI plans from your bank ("EMI from ₹X/month"), and you choose one at checkout. The EMI loan and its interest are with your bank, not with us.',
        links: [{ label: 'Browse products', href: '/products' }],
      },
      {
        question: 'Can I change or cancel my order after placing it?',
        answer: 'You can cancel within 2 hours of placing your order by contacting our customer service team. After that, it depends on how far the order has been processed. Once it has been dispatched it cannot be cancelled, but our return policy applies.',
        links: [{ label: 'Contact us', href: '/contact' }, { label: 'Terms & conditions', href: '/terms' }],
      },
    ],
  },
  {
    id: 'shipping',
    title: 'Shipping & Delivery',
    faqs: [
      {
        question: 'What are your shipping options and delivery times?',
        answer: 'We deliver across India through trusted courier partners such as Delhivery. Standard delivery usually takes 3–5 business days after dispatch. Parts we order in from a supplier can take a little longer, and we keep you updated.',
        links: [{ label: 'Shipping & delivery', href: '/shipping' }],
      },
      {
        question: 'How much does shipping cost?',
        answer: 'Delivery is free on every order. The total you see at checkout is the total you pay.',
      },
      {
        question: 'Do you ship internationally?',
        answer: 'Not at the moment — we deliver within India only.',
      },
      {
        question: 'How can I track my order?',
        answer: 'When your order is dispatched you receive the courier name and tracking number. You can follow every update — picked up, in transit, out for delivery — under "My Orders", or on our Track Order page without signing in.',
        links: [{ label: 'My orders', href: '/orders' }, { label: 'Track an order', href: '/track' }],
      },
    ],
  },
  {
    id: 'returns',
    title: 'Returns, Refunds & Warranty',
    faqs: [
      {
        question: RETURN_POLICY_QUESTION,
        answer: RETURN_POLICY_SUMMARY,
        links: [{ label: 'Read the return policy', href: '/returns' }],
      },
      {
        question: 'How do I return an item?',
        answer: 'Sign in, open "My Orders", choose the order and tap "Return". Pick the items and the reason, and add at least one photo (a video for transit damage or items over ₹10,000). You can also call or WhatsApp us and our team raises it for you. Once we approve the request, we arrange the pickup.',
        links: [{ label: 'My orders', href: '/orders' }, { label: 'Return policy', href: '/returns' }],
      },
      {
        question: 'How long does it take to process a refund?',
        answer: 'When the returned item reaches our warehouse we inspect it, and once it passes, the refund is sent to your original payment method and usually reaches you in 5 to 9 business days. How soon it shows in your account then depends on your bank.',
        links: [{ label: 'Return policy', href: '/returns' }],
      },
      {
        question: 'What is covered under warranty?',
        answer: 'Products carry the manufacturer\'s warranty against material failures and premature component failure under normal use. It does not cover damage from misuse, accidents, or modifications to the product.',
        links: [{ label: 'Warranty details', href: '/warranty' }],
      },
    ],
  },
  {
    id: 'products',
    title: 'Products, Fitment & Installation',
    faqs: [
      {
        question: 'Are all products genuine?',
        answer: 'Yes. Everything we sell is 100% genuine, sourced from the brands or their authorised distributors.',
      },
      {
        question: 'How can I be sure a product fits my vehicle?',
        answer: 'Use "Select your vehicle" at the top of the site and we show only parts that fit it. Every product page also lists its compatible vehicles. Still unsure? Ask a specialist and we will confirm the fit before you buy.',
        links: [{ label: 'Shop by vehicle', href: '/vehicles' }, { label: 'Consult a specialist', href: '/consultation' }],
      },
      {
        question: 'Do you offer installation services?',
        answer: 'Yes — we install the accessories we sell. Tell us your car and the part, and we will book the installation with you.',
        links: [{ label: 'Book through a specialist', href: '/consultation' }, { label: 'Contact us', href: '/contact' }],
      },
      {
        question: 'Can you get a part that is not on the website?',
        answer: 'Often, yes. Tell us your vehicle and what you need, and our team will check with our suppliers.',
        links: [{ label: 'Ask a specialist', href: '/consultation' }],
      },
    ],
  },
  {
    id: 'account',
    title: 'Account & Help',
    faqs: [
      {
        question: 'How do I create an account?',
        answer: 'Tap "Hello, sign in" at the top, then "Create your AutoBacs account". You can also sign in with Google or Facebook.',
        links: [{ label: 'Create an account', href: '/register' }],
      },
      {
        question: 'I forgot my password. How can I reset it?',
        answer: 'On the sign-in page tap "Forgot Password" and enter your email. We send you a link to set a new password.',
        links: [{ label: 'Reset my password', href: '/forgot-password' }],
      },
      {
        question: 'How do I update my details or delivery address?',
        answer: 'Sign in and open your Profile to change your name, phone number and saved addresses.',
        links: [{ label: 'My profile', href: '/profile' }],
      },
      {
        question: 'How do I contact you?',
        answer: `Call or WhatsApp us on ${SUPPORT_PHONE_DISPLAY}, email ${SUPPORT_EMAIL}, or send a message from our Contact page. We are available Monday to Saturday, 10 AM to 6 PM.`,
        links: [{ label: 'Contact us', href: '/contact' }],
      },
    ],
  },
];

/** Flat list, for search. */
export const ALL_FAQS: Faq[] = FAQ_CATEGORIES.flatMap((c) => c.faqs);
