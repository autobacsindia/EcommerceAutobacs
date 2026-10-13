/**
 * What the help bot answers, and how it decides.
 *
 * ── Why rules and not a language model ──────────────────────────────────────
 * This bot talks to customers about prices, stock, delivery and returns. A
 * model that paraphrases from memory will eventually state a shipping
 * threshold, a return window or a price that is not the one the server would
 * apply — and on a commerce site that is a consumer-law problem, not a tone
 * problem. Everything here is either a literal sentence from the site's own FAQ
 * or a link to the page that owns the answer. The bot can say "I don't know";
 * it cannot make something up.
 *
 * ── How matching works ──────────────────────────────────────────────────────
 * Each intent carries keywords. A question scores one point per keyword found,
 * with a bonus for a phrase match, and the best scorer above a floor wins. It
 * is deliberately simple and inspectable: when the bot answers the wrong thing,
 * the fix is a keyword, not a retrain.
 *
 * Anything that does not match the floor becomes a product search — on a parts
 * catalogue most free text is someone naming a part.
 */
import { ALL_FAQS, type Faq } from './faq';

/** A button under an answer: an internal route or an external link. */
export interface Action {
  label: string;
  href: string;
  /** Opens in a new tab, for WhatsApp/tel/mail. */
  external?: boolean;
}

export interface Answer {
  /** The reply text. Plain sentences — no markdown rendering in the panel. */
  text: string;
  actions?: Action[];
  /** Run a live product search for the raw question instead of a fixed reply. */
  search?: boolean;
  /** Follow-up chips offered after this answer. */
  followUps?: string[];
}

export interface Intent {
  id: string;
  /** Lowercase single words or phrases. A phrase match scores double. */
  keywords: string[];
  answer: (question: string) => Answer;
}

/** The chips shown before anyone types — the four things people actually ask. */
export const STARTERS = [
  'Find a part for my car',
  'Where is my order?',
  'Delivery and shipping',
  'Returns and warranty',
  'Talk to a person',
] as const;

const FAQ = (q: string): Faq | undefined =>
  ALL_FAQS.find((f) => f.question.toLowerCase().includes(q.toLowerCase()));

/** Literal FAQ answer when we have one, else the supplied fallback. */
const fromFaq = (match: string, fallback: string): string => FAQ(match)?.answer ?? fallback;

export const INTENTS: Intent[] = [
  {
    id: 'order-status',
    keywords: ['where is my order', 'track', 'tracking', 'my order', 'order status', 'delivered yet', 'shipped'],
    answer: () => ({
      text: fromFaq(
        'How can I track my order',
        'Once your order ships you get a tracking number by email, and you can follow it in your account.',
      ),
      actions: [
        { label: 'My orders', href: '/orders' },
        { label: 'Track without signing in', href: '/track' },
      ],
      followUps: ['Delivery and shipping', 'Cancel my order'],
    }),
  },
  {
    id: 'shipping',
    keywords: ['shipping', 'delivery', 'how long', 'dispatch', 'courier', 'ship to', 'free shipping', 'delivery charge'],
    answer: () => ({
      text: `${fromFaq('shipping options and delivery times', '')} ${fromFaq('How much does shipping cost', '')}`.trim(),
      actions: [{ label: 'Shipping & delivery', href: '/shipping' }],
      followUps: ['Where is my order?', 'Do you ship internationally?'],
    }),
  },
  {
    id: 'international',
    keywords: ['international', 'outside india', 'abroad', 'overseas', 'export'],
    answer: () => ({
      text: fromFaq('ship internationally', 'We currently ship within India only.'),
      actions: [{ label: 'Shipping & delivery', href: '/shipping' }],
    }),
  },
  {
    id: 'returns',
    keywords: ['return', 'refund', 'exchange', 'send it back', 'money back', 'warranty', 'guarantee', 'damaged', 'faulty'],
    answer: () => ({
      text: `${fromFaq('How do I return an item', '')} ${fromFaq('How long does it take to process a refund', '')}`.trim(),
      actions: [
        { label: 'Returns policy', href: '/returns' },
        { label: 'Warranty', href: '/warranty' },
        { label: 'My orders', href: '/orders' },
      ],
    }),
  },
  {
    id: 'cancel',
    keywords: ['cancel', 'cancel my order', 'change my order', 'stop the order'],
    answer: () => ({
      text: fromFaq('change or cancel my order', ''),
      actions: [{ label: 'My orders', href: '/orders' }, { label: 'Contact us', href: '/contact' }],
    }),
  },
  {
    id: 'payment',
    keywords: ['payment', 'pay', 'upi', 'card', 'razorpay', 'emi', 'netbanking', 'cod', 'cash on delivery', 'secure'],
    answer: () => ({
      text: `${fromFaq('What payment methods do you accept', '')} ${fromFaq('safe to use my credit card', '')}`.trim(),
      followUps: ['Where is my order?', 'Returns and warranty'],
    }),
  },
  {
    id: 'fitment',
    keywords: ['fit', 'fitment', 'will it fit', 'compatible', 'my car', 'my vehicle', 'suitable for', 'model'],
    answer: () => ({
      text: fromFaq('sure a product fits my vehicle', ''),
      actions: [
        { label: 'Shop by vehicle', href: '/vehicles' },
        { label: 'Ask a specialist', href: '/consultation' },
      ],
      followUps: ['Find a part for my car', 'Talk to a person'],
    }),
  },
  {
    id: 'installation',
    keywords: ['install', 'installation', 'fitting', 'fitter', 'garage near', 'workshop'],
    answer: () => ({
      text: fromFaq('offer installation services', ''),
      actions: [{ label: 'Book a consultation', href: '/consultation' }],
    }),
  },
  {
    id: 'genuine',
    keywords: ['genuine', 'original', 'fake', 'authentic', 'real product', 'duplicate'],
    answer: () => ({
      text: fromFaq('Are all products genuine', ''),
      actions: [{ label: 'About us', href: '/about-us' }],
    }),
  },
  {
    id: 'account',
    keywords: ['account', 'profile', 'sign in', 'login', 'log in', 'register', 'password', 'forgot', 'my details'],
    answer: () => ({
      text: fromFaq('forgot my password', 'You can manage your details, addresses and orders from your account.'),
      actions: [
        { label: 'My profile', href: '/profile' },
        { label: 'Sign in', href: '/login' },
        { label: 'Reset password', href: '/forgot-password' },
      ],
    }),
  },
  {
    id: 'offers',
    keywords: ['offer', 'discount', 'deal', 'sale', 'coupon', 'promo', 'cheap', 'price drop'],
    answer: () => ({
      text: 'Our live discounts are all on the offers page — every one shows the M.R.P. beside the deal price.',
      actions: [{ label: "Today's deals", href: '/offers' }],
    }),
  },
  {
    id: 'contact',
    keywords: ['talk to a person', 'human', 'agent', 'call', 'phone', 'whatsapp', 'email', 'contact', 'speak to', 'support'],
    answer: () => ({
      text: 'Happy to put you through to the team — they answer on WhatsApp fastest.',
      actions: [{ label: 'Contact us', href: '/contact' }],
      followUps: ['Find a part for my car', 'Where is my order?'],
    }),
  },
  {
    id: 'find-part',
    keywords: ['find a part', 'looking for', 'do you have', 'do you sell', 'search', 'need a', 'want a', 'buy'],
    answer: (q) => ({
      text: `Here's what I found for “${q.trim()}”.`,
      search: true,
    }),
  },
];

const STOP = new Set([
  'the', 'a', 'an', 'is', 'are', 'do', 'does', 'did', 'can', 'i', 'my', 'me', 'you', 'your',
  'to', 'for', 'of', 'in', 'on', 'it', 'and', 'or', 'how', 'what', 'where', 'when', 'please',
]);

/**
 * Score one intent against a question.
 *
 * A multi-word keyword that appears verbatim counts double: "where is my order"
 * is a far stronger signal than the word "order" alone, which also appears in
 * "can I cancel my order".
 */
export function scoreIntent(intent: Intent, question: string): number {
  const q = ` ${question.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ')} `;
  let score = 0;
  for (const kw of intent.keywords) {
    if (kw.includes(' ')) {
      if (q.includes(` ${kw} `)) score += 2;
    } else if (!STOP.has(kw) && q.includes(` ${kw}`)) {
      // Word START, not whole word: customers write "internationally",
      // "returns", "shipping" and "tracking" where the keyword is
      // "international", "return", "ship" and "track". Requiring both
      // boundaries missed every one of those.
      score += 1;
    }
  }
  return score;
}

/**
 * Best intent for a question, or null when nothing is confident enough.
 *
 * Null is a real answer: the caller turns it into a product search, which on a
 * parts catalogue is usually what an unmatched question actually wanted.
 */
export function matchIntent(question: string): Intent | null {
  let best: Intent | null = null;
  let bestScore = 0;
  for (const intent of INTENTS) {
    const score = scoreIntent(intent, question);
    if (score > bestScore) {
      best = intent;
      bestScore = score;
    }
  }
  return bestScore >= 1 ? best : null;
}

/** The reply for a question — an intent's answer, or a product search. */
export function answerFor(question: string): Answer {
  const intent = matchIntent(question);
  if (!intent) {
    return {
      text: `I'll search the catalogue for “${question.trim()}”.`,
      search: true,
      followUps: ['Talk to a person', 'Delivery and shipping'],
    };
  }
  return intent.answer(question);
}
