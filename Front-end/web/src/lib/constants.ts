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
  WISHLIST_ADD: '/wishlist/add',
  WISHLIST_REMOVE: (productId: string) => `/wishlist/remove/${productId}`,
  WISHLIST_CLEAR: '/wishlist/clear',
  
  // Orders
  ORDERS: '/orders',
  ORDER_DETAIL: (id: string) => `/orders/${id}`,
  ORDER_CANCEL: (id: string) => `/orders/${id}/cancel`,
  ADMIN_ORDERS: '/orders/admin/all',
  ORDER_UPDATE_STATUS: (id: string) => `/orders/${id}/status`,
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

// Navigation Links
export const NAV_LINKS = [
  { href: '/', label: 'Home' },
  { href: '/products', label: 'Products' },
  { href: '/categories', label: 'Categories' },
  { href: '/vehicles', label: 'Vehicles' },
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
