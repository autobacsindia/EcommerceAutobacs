/**
 * API Router - Domain-Driven Route Aggregation
 * 
 * Groups all routes by domain and applies domain-level middleware.
 * This is the single entry point for all /api/v1/* routes.
 * 
 * Architecture:
 * - Auth Domain: authentication, social auth, token introspection
 * - Product Domain: products, categories, brands, vehicles, questions
 * - User Domain: users, profile, cart, wishlist, reviews
 * - Order Domain: orders, returns, payments, razorpay
 * - Admin Domain: dashboard, warehouses, delivery zones, wordpress, media
 * - Location Domain: location services
 * - Contact Domain: contact forms, consultations
 * - Monitoring Domain: rate limits, redis, adaptive throttling, scheduled tasks
 */

import express from 'express';
import { 
  publicBrowsingRateLimit,
  authenticatedUserRateLimit,
  checkoutRateLimit,
  adminRouteRateLimit,
  locationRateLimit,
  contactFormRateLimit,
  consultationRateLimit,
  returnsRateLimit
} from '../middleware/rateLimitMiddleware.js';
import { setRequestTimeout } from '../app.js';
import { optionalAuth } from '../middleware/authMiddleware.js';

// Import domain route modules
import authRoutes from './auth.js';
import tokenIntrospectionRoutes from './tokenIntrospection.js';

import productRoutes from './products.js';
import categoryRoutes from './categories.js';
import brandRoutes from './brands.js';
import vehicleRoutes from './vehicles.js';
import productQuestionRoutes from './productQuestions.js';

import userRoutes from './users.js';
import profileRoutes from './profile.js';
import cartRoutes from './cart.js';
import wishlistRoutes from './wishlist.js';
import reviewRoutes from './reviews.js';

import orderRoutes from './orders.js';
import returnRoutes from './returnRoutes.js';
import razorpayRoutes from './razorpay.js';
import paymentMethodRoutes from './paymentMethods.js';
import checkoutRoutes from './checkout.js';
import couponRoutes from './coupons.js';
import loyaltyRoutes from './loyalty.js';

import dashboardRoutes from './dashboard.js';
import analyticsRoutes from './analytics.js';
import leadRoutes from './leads.js';
import warehouseRoutes from './warehouses.js';
import deliveryZoneRoutes from './deliveryZones.js';
import mediaRoutes from './media.js';
import pageSeoRoutes from './pageSeo.js';
import scheduledTasksRoutes from './scheduledTasks.js';

import locationRoutes from './location.js';
import contactRoutes from './contact.js';
import consultationRoutes from './consultation.js';

import rateLimitDashboardRoutes from './rateLimitDashboard.js';
import adaptiveThrottlingRoutes from './adaptiveThrottling.js';
import redisMonitorRoutes from './redisMonitor.js';
import securityRoutes from './security.js';
import adminStatsRoutes from './adminStats.js';

const apiRouter = express.Router();

// ============================================================================
// AUTH DOMAIN
// Routes: /auth/*, /admin/token/*
// Rate Limit: 5 req/min (strict for security)
// ============================================================================
apiRouter.use('/auth', authRoutes);
// DISABLED: socialAuthRoutes conflicts with auth.js Google OAuth implementation
// The auth.js version uses secure one-time code exchange (PKCE-lite) with Redis
// apiRouter.use('/auth', socialAuthRoutes);
apiRouter.use('/admin/token', tokenIntrospectionRoutes);

// ============================================================================
// PRODUCT DOMAIN
// Routes: /products/*, /categories/*, /brands/*, /vehicles/*, /product-questions/*
// Rate Limit: 300 req/min (public browsing)
// Timeout: 60s for search (complex queries)
// ============================================================================
apiRouter.use('/products/search', setRequestTimeout(60000), publicBrowsingRateLimit, productRoutes);
apiRouter.use('/products', publicBrowsingRateLimit, productRoutes);
apiRouter.use('/categories', publicBrowsingRateLimit, categoryRoutes);
apiRouter.use('/brands', publicBrowsingRateLimit, brandRoutes);
apiRouter.use('/vehicles', publicBrowsingRateLimit, vehicleRoutes);
apiRouter.use('/product-questions', publicBrowsingRateLimit, productQuestionRoutes);

// ============================================================================
// USER DOMAIN
// Routes: /users/*, /profile/*, /cart/*, /wishlist/*, /reviews/*
// Rate Limit: 600 req/min (authenticated users)
// ============================================================================
apiRouter.use('/users', authenticatedUserRateLimit, userRoutes);
apiRouter.use('/profile', authenticatedUserRateLimit, profileRoutes);
apiRouter.use('/cart', publicBrowsingRateLimit, optionalAuth, cartRoutes);  // Cart supports guest and authenticated users
apiRouter.use('/wishlist', authenticatedUserRateLimit, wishlistRoutes);
apiRouter.use('/reviews', publicBrowsingRateLimit, reviewRoutes);  // Reviews can be browsed publicly

// ============================================================================
// ORDER DOMAIN
// Routes: /orders/*, /returns/*, /razorpay/*, /payment-methods/*
// Rate Limit: 60 req/min (checkout)
// Timeout: 120s for orders/payments (external API calls)
// ============================================================================
apiRouter.use('/orders', setRequestTimeout(120000), checkoutRateLimit, orderRoutes);
apiRouter.use('/returns', setRequestTimeout(60000), returnsRateLimit, returnRoutes);
apiRouter.use('/razorpay', setRequestTimeout(120000), checkoutRateLimit, razorpayRoutes);
apiRouter.use('/payment-methods', checkoutRateLimit, paymentMethodRoutes);
// Checkout pricing preview (coupon + karma). optionalAuth personalises eligibility for guests/users.
apiRouter.use('/checkout', checkoutRateLimit, optionalAuth, checkoutRoutes);
// Coupons: /available is public; admin CRUD is guarded in-route.
apiRouter.use('/coupons', publicBrowsingRateLimit, optionalAuth, couponRoutes);
// Loyalty/karma: storefront balance + admin config (guarded in-route).
apiRouter.use('/loyalty', authenticatedUserRateLimit, loyaltyRoutes);

// ============================================================================
// ADMIN DOMAIN
// Routes: /dashboard/*, /warehouses/*, /delivery-zones/*, /wordpress/*, /media/*, /scheduled-tasks/*
// Rate Limit: 200 req/15min (stricter than global 500 - higher value targets)
// Timeout: 120s for wordpress sync (bulk operations)
// ============================================================================
apiRouter.use('/dashboard', adminRouteRateLimit, dashboardRoutes);
// Historical analytics (admin-only, cached): /analytics/{overview,sales,revenue-breakdown,products,customers,geo,loyalty,returns-payments}
apiRouter.use('/analytics', adminRouteRateLimit, analyticsRoutes);
// Sales CRM / leads (admin-only; guarded in-route with protect+admin)
apiRouter.use('/leads', adminRouteRateLimit, leadRoutes);
apiRouter.use('/warehouses', adminRouteRateLimit, warehouseRoutes);
apiRouter.use('/delivery-zones', adminRouteRateLimit, deliveryZoneRoutes);
apiRouter.use('/media', publicBrowsingRateLimit, mediaRoutes); // Public read access
apiRouter.use('/page-seo', publicBrowsingRateLimit, pageSeoRoutes); // Public read; admin write guarded in-route
apiRouter.use('/scheduled-tasks', adminRouteRateLimit, scheduledTasksRoutes);

// ============================================================================
// ADMIN MONITORING DOMAIN
// Routes: /admin/rate-limits/dashboard, /admin/adaptive-throttling, /admin/redis, /admin/stats
// Rate Limit: Admin-only (no rate limit applied here, protected by auth middleware in routes)
// ============================================================================
apiRouter.use('/admin/rate-limits/dashboard', rateLimitDashboardRoutes);
apiRouter.use('/admin/adaptive-throttling', adaptiveThrottlingRoutes);
apiRouter.use('/admin/redis', redisMonitorRoutes);
apiRouter.use('/admin', adminStatsRoutes);

// ============================================================================
// LOCATION DOMAIN
// Routes: /location/*
// Rate Limit: 30 req/15min (Google Maps costs money)
// ============================================================================
apiRouter.use('/location', locationRateLimit, locationRoutes);

// ============================================================================
// CONTACT DOMAIN
// Routes: /contact/*, /consultation/*
// Rate Limit: 10 req/hour (contact), 5 req/hour (consultation) - spam prevention
// ============================================================================
apiRouter.use('/contact', contactFormRateLimit, contactRoutes);
apiRouter.use('/consultation', consultationRateLimit, consultationRoutes);

// ============================================================================
// SECURITY DOMAIN
// Routes: /security/* (CSP reports, security headers test)
// Rate Limit: None for CSP reports (browsers send automatically), protected by rate limiting middleware
// ============================================================================
apiRouter.use('/security', securityRoutes);

export default apiRouter;
