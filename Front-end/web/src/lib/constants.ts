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
  PRODUCT_DETAIL: (id: string) => `/products/${id}`,
  FEATURED_PRODUCTS: '/products/featured',
  
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
  
  // Returns
  RETURNS_LIST: '/orders/admin/returns',
  RETURN_CREATE: '/returns',
  MY_RETURNS: '/returns/my-returns',
  WALLET: '/returns/wallet',
  ADMIN_RETURNS: '/returns/admin/all',
  RETURN_STATUS: (id: string) => `/returns/${id}/status`,
  RETURN_APPROVE: (orderId: string) => `/orders/${orderId}/return/approve`,
  RETURN_REJECT: (orderId: string) => `/orders/${orderId}/return/reject`,
  RETURN_ITEM_RECEIVED: (orderId: string) => `/orders/${orderId}/return/item-received`,
  
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

  // Loyalty / Karma points
  LOYALTY_ME: '/loyalty/me',
  LOYALTY_HISTORY: '/loyalty/history',
  LOYALTY_CONFIG: '/loyalty/config',                     // admin get/update
  LOYALTY_ADJUST: (userId: string) => `/loyalty/users/${userId}/adjust`,

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
};

// Order Status
export const ORDER_STATUS = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  PROCESSING: 'processing',
  SHIPPED: 'shipped',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded',
  FAILED: 'failed',
} as const;

export const ORDER_STATUS_LABELS: Record<string, string> = {
  [ORDER_STATUS.PENDING]: 'Pending',
  [ORDER_STATUS.CONFIRMED]: 'Confirmed',
  [ORDER_STATUS.PROCESSING]: 'Processing',
  [ORDER_STATUS.SHIPPED]: 'Shipped',
  [ORDER_STATUS.DELIVERED]: 'Delivered',
  [ORDER_STATUS.CANCELLED]: 'Cancelled',
  [ORDER_STATUS.REFUNDED]: 'Refunded',
  [ORDER_STATUS.FAILED]: 'Failed',
};

// Statuses whose change emails the customer (mirrors backend NOTIFY_STATUSES in
// orderStatusService.js). Used by the admin confirm dialog to warn that a status
// change will notify the customer. `confirmed` is excluded — the invoice email covers it.
export const CUSTOMER_NOTIFIED_STATUSES = ['shipped', 'delivered', 'cancelled', 'refunded'];

export const ORDER_STATUS_COLORS: Record<string, string> = {
  [ORDER_STATUS.PENDING]: 'bg-yellow-100 text-yellow-800',
  [ORDER_STATUS.CONFIRMED]: 'bg-emerald-100 text-emerald-800',
  [ORDER_STATUS.PROCESSING]: 'bg-blue-100 text-blue-800',
  [ORDER_STATUS.SHIPPED]: 'bg-purple-100 text-purple-800',
  [ORDER_STATUS.DELIVERED]: 'bg-green-100 text-green-800',
  [ORDER_STATUS.CANCELLED]: 'bg-red-100 text-red-800',
  [ORDER_STATUS.REFUNDED]: 'bg-orange-100 text-orange-800',
  [ORDER_STATUS.FAILED]: 'bg-red-100 text-red-800',
};

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

// Return Reasons
export const RETURN_REASONS = [
  { value: 'defective', label: 'Defective or damaged', description: 'Item has defects or arrived damaged' },
  { value: 'wrong_item', label: 'Wrong item received', description: 'Received incorrect product' },
  { value: 'other', label: 'Other reason', description: 'Please specify your reason' },
] as const;

export const RETURN_POLICY_POINTS = [
  'Items must be unused and in original packaging',
  'Return shipping label will be provided after approval',
  'Refund processed within 5-7 days after item received',
  'Shipping costs may not be refunded',
];

// Image Upload Constants
export const IMAGE_UPLOAD = {
  MAX_FILES: 5,
  MAX_FILE_SIZE: 5 * 1024 * 1024, // 5MB in bytes
  ACCEPTED_FORMATS: ['image/jpeg', 'image/png', 'image/webp'],
  ACCEPTED_EXTENSIONS: ['.jpg', '.jpeg', '.png', '.webp'],
} as const;