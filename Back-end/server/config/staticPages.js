/**
 * Catalogue of static, entity-less routes that the admin can manage SEO for via
 * the "Pages SEO" screen. This is the single source of truth for WHICH pages
 * exist and their human label + computed-default copy.
 *
 * Adding a brand-new static page = add a code route + one entry here. Editing
 * the copy that ships when no override is set = edit `defaultTitle` /
 * `defaultDescription` here.
 *
 * `path` is the public route, lowercased to match PageSeo.path. `group` only
 * drives how the admin screen sections the list.
 */
export const STATIC_PAGES = [
  // Core
  { path: '/', label: 'Home', group: 'Core',
    defaultTitle: 'Autobacs India | Premium Automotive Accessories',
    defaultDescription: "Shop premium automotive accessories, body kits, and performance parts from India's trusted auto parts retailer." },

  // Company
  { path: '/about-us', label: 'About Us', group: 'Company',
    defaultTitle: 'About Us',
    defaultDescription: 'Learn about Autobacs India — our story, mission, and the team behind India’s trusted auto accessories retailer.' },
  { path: '/careers', label: 'Careers', group: 'Company',
    defaultTitle: 'Careers',
    defaultDescription: 'Join the Autobacs India team and help us revolutionize the automotive accessories industry in India.' },
  { path: '/contact', label: 'Contact Us', group: 'Company',
    defaultTitle: 'Contact Us',
    defaultDescription: 'Get in touch with Autobacs India — sales, support, and store enquiries.' },

  // Support
  { path: '/faq', label: 'FAQ', group: 'Support',
    defaultTitle: 'Frequently Asked Questions',
    defaultDescription: 'Answers to common questions about products, orders, shipping, returns, and installation at Autobacs India.' },
  { path: '/shipping', label: 'Shipping', group: 'Support',
    defaultTitle: 'Shipping & Delivery',
    defaultDescription: 'Shipping options, timelines, and nationwide delivery information for Autobacs India orders.' },
  { path: '/returns', label: 'Returns', group: 'Support',
    defaultTitle: 'Returns & Refunds',
    defaultDescription: 'Our return and refund policy for automotive accessories purchased from Autobacs India.' },
  { path: '/warranty', label: 'Warranty', group: 'Support',
    defaultTitle: 'Warranty',
    defaultDescription: 'Warranty coverage and claims for products purchased from Autobacs India.' },
  { path: '/track', label: 'Track Order', group: 'Support',
    defaultTitle: 'Track Your Order',
    defaultDescription: 'Track the status of your Autobacs India order in real time.' },
  { path: '/help', label: 'Help', group: 'Support',
    defaultTitle: 'Help Centre',
    defaultDescription: 'Help and support resources for shopping with Autobacs India.' },

  // Legal
  { path: '/privacy', label: 'Privacy Policy', group: 'Legal',
    defaultTitle: 'Privacy Policy',
    defaultDescription: 'How Autobacs India collects, uses, and protects your personal information.' },
  { path: '/terms', label: 'Terms & Conditions', group: 'Legal',
    defaultTitle: 'Terms & Conditions',
    defaultDescription: 'The terms and conditions governing use of the Autobacs India website and services.' },
];

/** Quick lookup by normalized path. */
export const STATIC_PAGE_BY_PATH = new Map(
  STATIC_PAGES.map((p) => [p.path.toLowerCase(), p])
);

export default STATIC_PAGES;
