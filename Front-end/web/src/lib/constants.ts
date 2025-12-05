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
  
  // Cart
  CART: '/cart',
  CART_ADD: '/cart/add',
  CART_UPDATE: (productId: string) => `/cart/update/${productId}`,
  CART_REMOVE: (productId: string) => `/cart/remove/${productId}`,
  CART_CLEAR: '/cart/clear',
  
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
  ORDER_ANALYTICS: '/orders/analytics/summary',
  ORDER_STATUS_HISTORY: (id: string) => `/orders/${id}/status-history`,
  
  // Returns
  RETURNS_LIST: '/orders/returns',
  RETURN_APPROVE: (orderId: string) => `/orders/${orderId}/return/approve`,
  RETURN_REJECT: (orderId: string) => `/orders/${orderId}/return/reject`,
  RETURN_ITEM_RECEIVED: (orderId: string) => `/orders/${orderId}/return/item-received`,
  
  // Refunds
  REFUNDS_LIST: '/orders/refunds',
  REFUND_PROCESS: (orderId: string) => `/orders/${orderId}/refund`,
};

// Order Status
export const ORDER_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  SHIPPED: 'shipped',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled',
} as const;

export const ORDER_STATUS_LABELS: Record<string, string> = {
  [ORDER_STATUS.PENDING]: 'Pending',
  [ORDER_STATUS.PROCESSING]: 'Processing',
  [ORDER_STATUS.SHIPPED]: 'Shipped',
  [ORDER_STATUS.DELIVERED]: 'Delivered',
  [ORDER_STATUS.CANCELLED]: 'Cancelled',
};

export const ORDER_STATUS_COLORS: Record<string, string> = {
  [ORDER_STATUS.PENDING]: 'bg-yellow-100 text-yellow-800',
  [ORDER_STATUS.PROCESSING]: 'bg-blue-100 text-blue-800',
  [ORDER_STATUS.SHIPPED]: 'bg-purple-100 text-purple-800',
  [ORDER_STATUS.DELIVERED]: 'bg-green-100 text-green-800',
  [ORDER_STATUS.CANCELLED]: 'bg-red-100 text-red-800',
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
  COD: 'cod',
} as const;

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  [PAYMENT_METHODS.RAZORPAY]: 'Razorpay (Card/UPI/Wallet)',
  [PAYMENT_METHODS.COD]: 'Cash on Delivery',
};

// Navigation Links - Bottom Row (Main Navigation)
export const NAV_LINKS = [
  { href: '/shop', label: 'Shop' },
  { href: '/brands', label: 'Brand' },
  { href: '/vehicles', label: 'Vehicle' },
  { href: '/categories', label: 'Categories' },
  { href: '/wishlist', label: 'Wishlist' },
  { href: '/offers', label: 'Offers' },
];

// Footer Links
export const FOOTER_LINKS = {
  company: [
    { href: '/about', label: 'About Us' },
    { href: '/contact', label: 'Contact' },
    { href: '/careers', label: 'Careers' },
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
    { href: '/refund', label: 'Refund Policy' },
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
  { value: 'not_as_described', label: 'Not as described', description: 'Item doesn\'t match description' },
  { value: 'changed_mind', label: 'Changed my mind', description: 'No longer need this item' },
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