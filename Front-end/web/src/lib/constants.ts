// Application constants

export const APP_NAME = 'Autobacs India';
export const APP_DESCRIPTION = 'Premium automotive accessories and performance parts';

// API Endpoints
export const API_ENDPOINTS = {
  // Auth
  LOGIN: '/auth/login',
  REGISTER: '/auth/register',
  GET_ME: '/auth/me',
  
  // Products
  PRODUCTS: '/products',
  // Admin-only list: includes inactive products, uncached (see backend getAdminProducts).
  ADMIN_PRODUCTS: '/products/admin/list',
  PRODUCT_DETAIL: (id: string) => `/products/${id}`,
  FEATURED_PRODUCTS: '/products/featured',

  // Back-in-stock ("Notify me") + on-backorder ("Join the waiting list").
  // Both are StockNotificationRequest rows, distinguished by `kind` on the query.
  NOTIFY_ME: (id: string) => `/products/${id}/notify-me`,
  JOIN_WAITLIST: (id: string) => `/products/${id}/join-waitlist`,
  STOCK_NOTIFICATIONS_MINE: '/stock-notifications/mine',
  STOCK_NOTIFICATION_CANCEL: (id: string) => `/stock-notifications/${id}`,
  ADMIN_STOCK_REQUESTS: '/stock-notifications/admin',
  ADMIN_STOCK_REQUESTERS: '/stock-notifications/admin/requesters',
  
  // Categories
  CATEGORIES: '/categories',
  CATEGORY_DETAIL: (id: string) => `/categories/${id}`,
  CATEGORY_BY_SLUG: (slug: string) => `/categories/slug/${slug}`,
  
  // Vehicles
  VEHICLES: '/vehicles',
  VEHICLE_DETAIL: (id: string) => `/vehicles/${id}`,
  VEHICLE_MAKES: '/vehicles/makes',
  VEHICLE_MODELS: (make: string) => `/vehicles/models/${make}`,
  VEHICLES_ADMIN: '/vehicles/admin/all',
  VEHICLE_CREATE: '/vehicles',
  VEHICLE_UPDATE: (id: string) => `/vehicles/${id}`,
  VEHICLE_DELETE: (id: string) => `/vehicles/${id}`,
  VEHICLE_TOGGLE_STATUS: (id: string) => `/vehicles/${id}/toggle-status`,
  VEHICLE_PRODUCTS: (id: string) => `/vehicles/${id}/products`,
  VEHICLE_MAP_PRODUCTS: (id: string) => `/vehicles/${id}/products/map`,
  VEHICLE_UNMAP_PRODUCT: (vehicleId: string, productId: string) => `/vehicles/${vehicleId}/products/${productId}`,
  
  // Cart
  CART: '/cart',
  CART_ADD: '/cart/add',
  CART_UPDATE: (productId: string) => `/cart/update/${productId}`,
  CART_REMOVE: (productId: string) => `/cart/remove/${productId}`,
  CART_CLEAR: '/cart/clear',
  CART_MERGE: '/cart/merge',
  CART_COUPON: '/cart/coupon',
  CART_VALIDATE: '/cart/validate',
  CART_VALIDATE_CHECKOUT: '/cart/validate-checkout',
  
  // Wishlist
  WISHLIST: '/wishlist',
  WISHLIST_ADD_ITEM: (wishlistId: string) => `/wishlist/${wishlistId}/items`,
  WISHLIST_REMOVE_ITEM: (wishlistId: string, productId: string) => `/wishlist/${wishlistId}/items/${productId}`,
  WISHLIST_CLEAR: (wishlistId: string) => `/wishlist/${wishlistId}/clear`,
  
  // Orders
  ORDERS: '/orders',
  ORDER_DETAIL: (id: string) => `/orders/${id}`,
  ORDER_CANCEL: (id: string) => `/orders/${id}/cancel`,
  ORDER_RETURN: (id: string) => `/orders/${id}/return`,
  ADMIN_ORDERS: '/orders/admin/all',
  ORDER_UPDATE_STATUS: (id: string) => `/orders/${id}/status`,
  ORDER_BULK_STATUS: '/orders/bulk/status',
  ORDER_BULK_DELETE: '/orders/bulk/delete',
  ORDER_ANALYTICS: '/orders/analytics/summary',
  ORDER_STATUS_HISTORY: (id: string) => `/orders/${id}/status-history`,
  
  // Returns — customer
  RETURN_CREATE: '/returns',
  RETURN_UPLOAD_SIGNATURE: '/returns/upload-signature',
  MY_RETURNS: '/returns/my-returns',
  RETURN_CANCEL: (id: string) => `/returns/${id}/cancel`,
  // Returns — admin
  ADMIN_RETURNS: '/returns/admin/all',
  ADMIN_RETURN_DETAIL: (id: string) => `/returns/admin/${id}`,
  RETURN_REVIEW: (id: string) => `/returns/admin/${id}/review`,
  RETURN_COURIER: (id: string) => `/returns/admin/${id}/courier`,
  RETURN_RECEIVED: (id: string) => `/returns/admin/${id}/received`,
  RETURN_INSPECTION: (id: string) => `/returns/admin/${id}/inspection`,
  RETURN_REFUND_PREVIEW: (id: string) => `/returns/admin/${id}/refund-preview`,
  RETURN_REFUND: (id: string) => `/returns/admin/${id}/refund`,

  // Refunds
  REFUNDS_LIST: '/orders/refunds',
  REFUND_PROCESS: (orderId: string) => `/orders/${orderId}/refund`,
  
  // Reviews
  REVIEWS: '/reviews',
  PRODUCT_REVIEWS: (productId: string) => `/products/${productId}/reviews`,
  CREATE_REVIEW: '/reviews',
  
  // Brands
  BRANDS: '/brands',
  BRAND_DETAIL: (id: string) => `/brands/${id}`,
  BRAND_CREATE: '/brands',
  BRAND_UPDATE: (id: string) => `/brands/${id}`,
  BRAND_DELETE: (id: string) => `/brands/${id}`,
  BRAND_PRODUCTS: (id: string) => `/brands/${id}/products`,
  BRAND_MAP_PRODUCTS: (id: string) => `/brands/${id}/products`,
  BRAND_UNMAP_PRODUCT: (brandId: string, productId: string) => `/brands/${brandId}/products/${productId}`,
  BRAND_TOGGLE_STATUS: (id: string) => `/brands/${id}/toggle-status`,
  
  // Checkout pricing (coupon + karma preview)
  CHECKOUT_QUOTE: '/checkout/quote',

  // Coupons
  COUPONS_AVAILABLE: '/coupons/available',
  COUPONS: '/coupons',                                   // admin list + create
  COUPON_DETAIL: (id: string) => `/coupons/${id}`,       // admin get/update/delete

  // Promotional campaigns (festival cards, sitewide sales)
  CAMPAIGNS: '/campaigns',                                              // admin list + create
  MAGIC_LINK_REQUEST: '/auth/magic-link/request',                       // emails a set-password link
  CAMPAIGN_ME: (slug: string) => `/campaigns/${slug}/me`,               // public eligibility
  // Identity-free, so unlike CAMPAIGN_ME this one is safe to cache and share.
  CAMPAIGN_PRODUCT_RATES: (slug: string) => `/campaigns/${slug}/product-rates`,
  CAMPAIGN_CHECK_EMAIL: (slug: string) => `/campaigns/${slug}/check-email`,
  // The signed-in customer claiming the offer off the printed card. Reachable only from
  // the campaign's landing page, which is unlinked and noindex — that is what makes an
  // offer public but unadvertised. Returns the same payload as CAMPAIGN_ME.
  CAMPAIGN_ACTIVATE: (slug: string) => `/campaigns/${slug}/activate`,
  CAMPAIGN_ADMIN: (slug: string) => `/campaigns/${slug}/admin`,
  CAMPAIGN_REPORT: (slug: string) => `/campaigns/${slug}/report`,
  // Who actually redeemed — the complete record for BOTH audiences, unlike the member
  // roster, which a public campaign never writes to.
  CAMPAIGN_REDEMPTIONS: (slug: string) => `/campaigns/${slug}/redemptions`,
  CAMPAIGN_DETAIL: (id: string) => `/campaigns/${id}`,                  // admin update
  CAMPAIGN_STATUS: (id: string) => `/campaigns/${id}/status`,           // the kill switch
  CAMPAIGN_MEMBERS: (id: string) => `/campaigns/${id}/members`,
  CAMPAIGN_SIMULATE: (id: string) => `/campaigns/${id}/simulate`,
  // Per-product discount tiers: authored from a search query, then materialized.
  CAMPAIGN_PRODUCT_TIERS: (id: string) => `/campaigns/${id}/product-tiers`,
  CAMPAIGN_PRODUCT_TIER_PREVIEW: (id: string) => `/campaigns/${id}/product-tiers/preview`,
  CAMPAIGN_PRODUCT_TIER_SIMULATE: (id: string) => `/campaigns/${id}/product-tiers/simulate`,
  CAMPAIGN_PRODUCT_TIER_DRIFT: (id: string) => `/campaigns/${id}/product-tiers/drift`,
  CAMPAIGN_PRODUCT_TIER_ITEM: (id: string, tierCode: string) =>
    `/campaigns/${id}/product-tiers/${tierCode}`,

  // Loyalty / Karma points
  LOYALTY_ME: '/loyalty/me',
  LOYALTY_HISTORY: '/loyalty/history',
  LOYALTY_CONFIG: '/loyalty/config',                     // admin get/update
  LOYALTY_ADJUST: (userId: string) => `/loyalty/users/${userId}/adjust`,

  // Promo banners (site-wide occasion strip)
  PROMO_BANNER_ACTIVE: '/promo-banners/active',           // public: the live banner
  PROMO_BANNERS_ADMIN: '/promo-banners/admin',            // admin list/create
  PROMO_BANNER_ADMIN_BY_ID: (id: string) => `/promo-banners/admin/${id}`,
  PROMO_BANNER_TOGGLE: (id: string) => `/promo-banners/admin/${id}/toggle`,

  // ── Spin-to-Win (post-purchase reward wheel) ──────────────────────────────
  // Customer: per-order, authenticated. Never edge-cached.
  SPIN_ORDER_STATUS: (orderId: string) => `/spin/orders/${orderId}`,
  SPIN_ORDER_SPIN: (orderId: string) => `/spin/orders/${orderId}`,
  SPIN_ORDER_REVIEW_CLICKED: (orderId: string) => `/spin/orders/${orderId}/review-clicked`,
  // Admin: campaigns
  SPIN_CAMPAIGNS_ADMIN: '/spin/admin/campaigns',
  SPIN_CAMPAIGN_BY_ID: (id: string) => `/spin/admin/campaigns/${id}`,
  SPIN_CAMPAIGN_PUBLISH: (id: string) => `/spin/admin/campaigns/${id}/publish`,
  SPIN_CAMPAIGN_STATUS: (id: string) => `/spin/admin/campaigns/${id}/status`,
  SPIN_CAMPAIGN_CLONE: (id: string) => `/spin/admin/campaigns/${id}/clone`,
  SPIN_CAMPAIGN_ODDS: (id: string) => `/spin/admin/campaigns/${id}/odds`,
  // Admin: prizes
  SPIN_CAMPAIGN_PRIZES: (id: string) => `/spin/admin/campaigns/${id}/prizes`,
  SPIN_PRIZE_BY_ID: (prizeId: string) => `/spin/admin/prizes/${prizeId}`,
  // Admin: the fulfilment queue
  SPIN_WINNERS: '/spin/admin/winners',
  SPIN_WINNER_FULFIL: (id: string) => `/spin/admin/winners/${id}/fulfil`,

  // Contact
  CONTACT: '/contact',

  // Media & News
  MEDIA_ARTICLES: '/media/articles',
  MEDIA_ARTICLE_BY_SLUG: (slug: string) => `/media/articles/${slug}`,
  MEDIA_ARTICLE_CATEGORIES: '/media/articles-categories',
  MEDIA_GALLERY: '/media/gallery',
  MEDIA_VIDEOS: '/media/videos',
  MEDIA_PRESS: '/media/press',
  // Admin
  ADMIN_MEDIA_ARTICLES: '/media/admin/articles',
  ADMIN_MEDIA_ARTICLE: (id: string) => `/media/admin/articles/${id}`,
  ADMIN_MEDIA_ITEMS: '/media/admin/media-items',
  ADMIN_MEDIA_ITEM: (id: string) => `/media/admin/media-items/${id}`,
  ADMIN_MEDIA_PRESS: '/media/admin/press',
  ADMIN_MEDIA_PRESS_ITEM: (id: string) => `/media/admin/press/${id}`,
  ADMIN_MEDIA_COMMENTS: '/media/admin/comments',
  ADMIN_MEDIA_COMMENT_APPROVE: (id: string) => `/media/admin/comments/${id}/approve`,
  ADMIN_MEDIA_COMMENT: (id: string) => `/media/admin/comments/${id}`,
  MEDIA_STATS: '/media/stats',
  MEDIA_TRENDING: '/media/trending',

  // Consultation
  CONSULTATION_SUBMIT: '/consultation',
  ADMIN_CONSULTATIONS: '/consultation/admin',
  ADMIN_CONSULTATION: (id: string) => `/consultation/admin/${id}`,
  ADMIN_CONSULTATION_STATUS: (id: string) => `/consultation/admin/${id}/status`,

  // Careers — public open roles (read) + admin CRUD
  CAREERS_POSTINGS: '/careers/postings',
  CAREERS_POSTING: (slug: string) => `/careers/postings/${slug}`,
  ADMIN_CAREERS_POSTINGS: '/careers/admin/postings',
  ADMIN_CAREERS_POSTING: (id: string) => `/careers/admin/postings/${id}`,
  // Careers — managed section categories (admin CRUD)
  ADMIN_CAREERS_CATEGORIES: '/careers/admin/categories',
  ADMIN_CAREERS_CATEGORIES_REORDER: '/careers/admin/categories/reorder',
  ADMIN_CAREERS_CATEGORY: (id: string) => `/careers/admin/categories/${id}`,
  // Careers — public application submission + admin review inbox
  CAREERS_UPLOAD_SIGNATURE: '/careers/applications/upload-signature',
  CAREERS_APPLICATIONS: '/careers/applications',
  ADMIN_CAREERS_APPLICATIONS: '/careers/admin/applications',
  ADMIN_CAREERS_APPLICATION: (id: string) => `/careers/admin/applications/${id}`,
};

// Order Status
// FULFILLMENT status only (the "where is the parcel?" axis). Payment lives in
// PAYMENT_STATUS_* below. `awaiting_payment` is the pre-payment state (shown as
// "—" in the orders list). Mirrors backend Order.status (Phase 2 two-axis split).
export const ORDER_STATUS = {
  AWAITING_PAYMENT: 'awaiting_payment',
  PROCESSING: 'processing',
  SHIPPED: 'shipped',
  DELIVERED: 'delivered',
  RETURNED: 'returned',
  CANCELLED: 'cancelled',
} as const;

export const ORDER_STATUS_LABELS: Record<string, string> = {
  [ORDER_STATUS.AWAITING_PAYMENT]: 'Awaiting payment',
  [ORDER_STATUS.PROCESSING]: 'Processing',
  [ORDER_STATUS.SHIPPED]: 'Shipped',
  [ORDER_STATUS.DELIVERED]: 'Delivered',
  [ORDER_STATUS.RETURNED]: 'Returned',
  [ORDER_STATUS.CANCELLED]: 'Cancelled',
};

// Statuses whose change emails the customer (mirrors backend
// CUSTOMER_NOTIFIED_STATUSES in orderStatusService.js). `processing` is excluded —
// the invoice email covers the payment moment.
export const CUSTOMER_NOTIFIED_STATUSES = ['shipped', 'delivered', 'cancelled', 'returned'];

export const ORDER_STATUS_COLORS: Record<string, string> = {
  [ORDER_STATUS.AWAITING_PAYMENT]: 'bg-gray-100 text-gray-600',
  [ORDER_STATUS.PROCESSING]: 'bg-blue-100 text-blue-800',
  [ORDER_STATUS.SHIPPED]: 'bg-purple-100 text-purple-800',
  [ORDER_STATUS.DELIVERED]: 'bg-green-100 text-green-800',
  [ORDER_STATUS.RETURNED]: 'bg-orange-100 text-orange-800',
  [ORDER_STATUS.CANCELLED]: 'bg-red-100 text-red-800',
};

// Payment axis (Order.paymentStatus) — the "did we get paid?" dimension, kept
// separate from the fulfillment status above. Drives the admin "Payment" column.
export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  pending: 'Awaiting',
  paid: 'Paid',
  failed: 'Failed',
  cancelled: 'Cancelled', // customer cancelled the payment popup
  refunded: 'Refunded',
  expired: 'Abandoned', // never returned to pay ("left at checkout") — settled by the sweep
};

export const PAYMENT_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  paid: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  cancelled: 'bg-rose-100 text-rose-800',
  refunded: 'bg-orange-100 text-orange-800',
  expired: 'bg-gray-200 text-gray-600',
};

// Payment states considered "unpaid outcomes" — excluded from the default admin Orders
// view (they live in the CRM Leads section) and surfaced by the "Unpaid / abandoned"
// filter. Mirrors ORDERS_DEFAULT_PAYMENT_STATUSES in the backend orderController.
export const UNPAID_PAYMENT_STATUSES = ['failed', 'cancelled', 'expired'] as const;

// User Roles
export const USER_ROLES = {
  CUSTOMER: 'customer',
  ADMIN: 'admin',
} as const;

// Pagination
export const DEFAULT_PAGE_SIZE = 20;
export const PRODUCTS_PER_PAGE = 20;

// Sort Options
export const SORT_OPTIONS = [
  { value: 'createdAt_desc', label: 'Newest First' },
  { value: 'createdAt_asc', label: 'Oldest First' },
  { value: 'price_asc', label: 'Price: Low to High' },
  { value: 'price_desc', label: 'Price: High to Low' },
  { value: 'name_asc', label: 'Name: A to Z' },
  { value: 'name_desc', label: 'Name: Z to A' },
  { value: 'rating_desc', label: 'Highest Rated' },
];

// Payment Methods
export const PAYMENT_METHODS = {
  RAZORPAY: 'razorpay',
} as const;

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  [PAYMENT_METHODS.RAZORPAY]: 'Razorpay (Card/UPI/Wallet)',
};

// Navigation Links - Bottom Row (Main Navigation)
// The header category nav is now data-driven — see `lib/navCategories.ts`
// (resolveNavCategories / getNavCategories). The previous hardcoded NAV_LINKS
// list used stale slugs (bodykit/audio/lights) that drifted from the real
// category data and required backend slug-translation hacks; it was removed.

// Footer Links
export const FOOTER_LINKS = {
  company: [
    { href: '/about', label: 'About Us' },
    { href: '/contact', label: 'Contact' },
    { href: '/careers', label: 'Careers' },
    { href: '/media', label: 'Press' },
    { href: '/blog', label: 'Blog' },
  ],
  support: [
    { href: '/faq', label: 'FAQ' },
    { href: '/shipping', label: 'Shipping Info' },
    { href: '/returns', label: 'Returns' },
    { href: '/warranty', label: 'Warranty' },
  ],
  legal: [
    { href: '/privacy', label: 'Privacy Policy' },
    { href: '/terms', label: 'Terms of Service' },
    { href: '/returns', label: 'Refund Policy' },
  ],
};

// Breakpoints (matching Tailwind)
export const BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
};

// Authentication Error Messages
export const AUTH_ERROR_MESSAGES = {
  RATE_LIMIT_EXCEEDED: (minutes: number) => `Too many attempts. Please try again in ${minutes} minute${minutes !== 1 ? 's' : ''}.`,
  INVALID_CREDENTIALS: 'Invalid email or password',
  ACCOUNT_EXISTS: 'An account with this email already exists',
  GENERIC_AUTH_ERROR: 'Authentication failed. Please try again.',
};

// Cancellation Reasons
export const CANCELLATION_REASONS = [
  { value: 'customer_request', label: 'Changed my mind' },
  { value: 'customer_request', label: 'Found better price elsewhere' },
  { value: 'duplicate_order', label: 'Ordered by mistake' },
  { value: 'payment_failed', label: 'Payment issues' },
  { value: 'customer_request', label: 'Other' },
] as const;

// Return Reasons — the ONLY accepted reasons per the signed policy (all
// Roavion-attributable). No change-of-mind / "other" path. Mirrors the backend
// config/returnPolicy.js RETURN_REASONS — keep both in sync.
export const RETURN_REASONS = [
  { value: 'wrong_item', label: 'Wrong item shipped', description: 'The item received differs from what was ordered' },
  { value: 'transit_damage', label: 'Damaged in transit', description: 'The product arrived damaged (shown in your unboxing video)' },
  { value: 'manufacturing_defect', label: 'Manufacturing defect', description: 'A genuine defect in the product as supplied' },
] as const;

// Return window (days from delivery). Mirrors backend RETURN_WINDOW_DAYS.
export const RETURN_WINDOW_DAYS = 4;

export const RETURN_POLICY_POINTS = [
  `Requests must be raised within ${RETURN_WINDOW_DAYS} days of delivery`,
  'A continuous unboxing video and proof of purchase are mandatory',
  'We arrange the return pickup after approval',
  'Refund is issued to your original payment method after the item passes inspection',
  'Electrical/electronic, custom-made and imported items are not returnable',
];

/**
 * Canonical customer-facing answer to "what is your return policy?".
 *
 * Every public surface that states the policy in prose — the /faq page, the
 * /contact and /help FAQ strips, and the FAQPage JSON-LD in app/layout.tsx —
 * MUST render this string rather than hand-writing its own version. Those five
 * surfaces had drifted to three different windows (30 / 7 / 4 days) and to an
 * any-reason "unused items" promise the backend never honoured, which is both a
 * consumer-protection exposure and a top support-ticket driver. Deriving the
 * copy from RETURN_WINDOW_DAYS is what stops it re-drifting.
 *
 * The wording tracks the signed Roavion "Return, Refund, Exchange & Cancellation
 * Policy" (v1.0) that Back-end/server/config/returnPolicy.js encodes: a
 * RETURN_WINDOW_DAYS window, the three fault-only RETURN_REASONS, and refund to
 * the original payment method. There is deliberately no change-of-mind path and
 * no exchange path — do not reintroduce either here without a policy change.
 */
export const RETURN_POLICY_SUMMARY =
  `Returns are accepted within ${RETURN_WINDOW_DAYS} days of delivery where the fault is ours — ` +
  'a wrong item shipped, damage in transit, or a manufacturing defect. ' +
  'A continuous unboxing video and proof of purchase are required, and we arrange ' +
  'the pickup once the request is approved. Approved returns are refunded to your ' +
  'original payment method after inspection; we do not offer exchanges or store credit. ' +
  'Electrical/electronic, custom-made, imported and already-installed items are not returnable.';

/** Shared question wording, so the FAQ strips and the JSON-LD stay identical. */
export const RETURN_POLICY_QUESTION = 'What is your return policy?';

// Image Upload Constants
export const IMAGE_UPLOAD = {
  MAX_FILES: 5,
  MAX_FILE_SIZE: 5 * 1024 * 1024, // 5MB in bytes
  ACCEPTED_FORMATS: ['image/jpeg', 'image/png', 'image/webp'],
  ACCEPTED_EXTENSIONS: ['.jpg', '.jpeg', '.png', '.webp'],
} as const;
/**
 * The campaign the storefront currently surfaces — the landing page at /festive, the
 * site-wide banner, and the cart savings meter all read this one slug.
 *
 * Changing occasions is a one-line edit here; the campaign itself (tiers, dates, who
 * qualifies, on/off) is configured in the admin screen, not in code. When no campaign
 * with this slug is live the eligibility endpoint 404s and every surface hides itself,
 * which is the correct steady state for most of the year.
 */
export const ACTIVE_CAMPAIGN_SLUG = 'festive-2026';
