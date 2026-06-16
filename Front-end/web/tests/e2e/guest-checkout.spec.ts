import { test, expect, request as playwrightRequest } from '@playwright/test';

/**
 * Guest checkout e2e — Phase 0 stabilization.
 *
 * History shows the guest cart/checkout path is fragile (8 separate fix docs:
 * GUEST_CART_401, GUEST_CART_SESSION_BASED, GUEST_CHECKOUT_CART_FIX, etc).
 * The pre-existing checkout.spec.ts only covers a *logged-in* user, so the
 * guest path had no regression guard. This file covers it.
 *
 * Two layers:
 *  1. UI flow (mocked network) — deterministic guest cart -> checkout -> Razorpay.
 *     Mirrors the mocking style of checkout.spec.ts but as a guest (no login).
 *  2. Real-backend API contract (opt-in via E2E_BACKEND_URL) — exercises the
 *     actual POST /orders/guest controller for BOTH 'razorpay' and 'cod'
 *     payment methods. COD has no UI selector today (PaymentMethodSelector
 *     lists Razorpay only), so it can only be verified at the API layer.
 */

const mockProduct = {
  _id: 'guest-mock-product-id',
  name: 'Guest Test Product',
  price: 1000,
  description: 'Guest Test Description',
  images: [{ url: 'https://placehold.co/200x200.png', isPrimary: true }],
  category: { _id: 'cat1', name: 'Test Category' },
  brand: { _id: 'brand1', name: 'Test Brand' },
  stock: 10,
  specifications: [],
  compatibility: [],
  isActive: true,
  createdAt: new Date().toISOString(),
};

const mockCart = {
  _id: 'guest-mock-cart-id',
  items: [{ product: mockProduct, quantity: 1 }],
  totalPrice: 1000,
  total: 1000,
};

test.describe('Guest checkout (UI, mocked network)', () => {
  test('guest cart -> checkout -> Razorpay places an order without logging in', async ({ page }) => {
    // Silence images.
    await page.route('**/*.{png,jpg,jpeg,webp,svg}', route =>
      route.fulfill({ status: 200, body: 'mock-image', contentType: 'image/png' }));
    await page.route('**/_next/image*', route =>
      route.fulfill({ status: 200, body: 'mock-image', contentType: 'image/png' }));

    // Force GUEST: /auth/me must NOT return a user.
    await page.route('**/api/auth/me', route =>
      route.fulfill({ status: 401, json: { success: false, message: 'Not authenticated' } }));

    // Product listing — inject our in-stock product.
    await page.route('**/api/products*', async route => {
      const response = await route.fetch();
      let json: any = {};
      try { json = await response.json(); } catch { json = {}; }
      json.products = [mockProduct, ...(json.products || [])];
      await route.fulfill({ json });
    });

    // Cart endpoints (session-based for guests).
    await page.route('**/api/cart/add', route =>
      route.fulfill({ json: { success: true, cart: mockCart } }));
    await page.route('**/api/cart/validate', route =>
      route.fulfill({
        json: {
          success: true,
          isValid: true,
          subtotal: 1000,
          tax: 0,
          total: 1000,
          items: [{ productId: mockProduct._id, quantity: 1, unitPrice: 1000 }],
        },
      }));
    await page.route('**/api/cart', route =>
      route.fulfill({ json: { success: true, cart: mockCart } }));

    // Guest order creation — note the /orders/guest endpoint, not /orders.
    await page.route('**/api/orders/guest', route =>
      route.fulfill({
        status: 201,
        json: {
          success: true,
          isGuest: true,
          magicLinkToken: 'mock-magic-token',
          order: { _id: 'guest-mock-order-id', orderNumber: 'AB-GUEST-1', totalAmount: 1000, status: 'pending' },
        },
      }));

    // Razorpay backend endpoints.
    await page.route('**/api/razorpay/create-order', route =>
      route.fulfill({
        json: { success: true, data: { id: 'rzp_order_mock', amount: 100000, currency: 'INR', orderId: 'rzp_order_mock' } },
      }));
    await page.route('**/api/razorpay/verify-payment', route =>
      route.fulfill({ json: { success: true, orderId: 'guest-mock-order-id' } }));

    // Noise reducers.
    await page.route('**/api/wishlist', route => route.fulfill({ json: { success: true, wishlist: [] } }));
    await page.route('**/api/categories*', route => route.fulfill({ json: { success: true, categories: [] } }));
    await page.route('**/api/brands*', route => route.fulfill({ json: { success: true, brands: [] } }));

    // Razorpay SDK mock — succeed immediately.
    await page.addInitScript(() => {
      (window as any).Razorpay = function (options: any) {
        this.open = function () {
          options.handler?.({
            razorpay_payment_id: 'pay_mock_123',
            razorpay_order_id: options.order_id,
            razorpay_signature: 'sig_mock_123',
          });
        };
        this.on = function () {};
      };
    });

    await page.goto('/products');

    // Confirm we are a guest (a Login affordance should still be reachable).
    await expect(page.getByText('Guest Test Product')).toBeVisible();

    await test.step('Add to cart', async () => {
      const productCard = page.locator('div').filter({ hasText: 'Guest Test Product' }).last();
      const addButton = productCard.locator('button', { hasText: 'Add' });
      await expect(addButton).toBeVisible();
      await addButton.click();
    });

    await test.step('Checkout as guest -> Razorpay', async () => {
      await page.goto('/cart', { waitUntil: 'domcontentloaded' });
      await expect(page.getByText('Proceed to Checkout')).toBeVisible();
      await page.click('text=Proceed to Checkout');

      // Step: cart review
      await expect(page.getByText('Review Your Cart')).toBeVisible();
      await page.click('text=Continue to Shipping');

      // Step: shipping address — guest contact fields appear here.
      await expect(page.getByText('Shipping Address')).toBeVisible();
      await page.fill('input[placeholder="your@email.com"]', `guest${Date.now()}@example.com`);
      await page.fill('input[placeholder="Full Name"]', 'Guest Buyer');
      await page.fill('input[placeholder="Street Address"]', '123 Guest St');
      await page.fill('input[placeholder="City"]', 'Guest City');
      await page.fill('input[placeholder="State"]', 'Guest State');
      await page.fill('input[placeholder="Postal Code"]', '123456');
      await page.fill('input[placeholder="Phone"]', '9876543210');
      await page.click('button:has-text("Continue to Payment")');

      // Step: payment (Razorpay is the only method today)
      await expect(page.getByText('Payment Method')).toBeVisible();
      await page.click('button:has-text("Continue to Review")');

      // Step: review
      await expect(page.getByText('Review Your Order')).toBeVisible();
      await page.click('button:has-text("Place Order")');

      // Confirmation
      await expect(page.getByText('Order Placed!', { exact: false })).toBeVisible({ timeout: 20000 });
    });
  });
});

/**
 * Real-backend guest order contract. Opt-in: set E2E_BACKEND_URL to the API
 * base (e.g. http://localhost:5000/api or a staging URL). Skipped otherwise so
 * the default `npm run test:e2e` stays hermetic.
 *
 * Covers the roadmap's "COD and Razorpay" requirement at the layer where COD
 * actually exists (the Order/Payment models accept paymentMethod 'cod'; the UI
 * does not yet expose it).
 */
const BACKEND = process.env.E2E_BACKEND_URL;

test.describe('Guest order API contract (real backend)', () => {
  test.skip(!BACKEND, 'Set E2E_BACKEND_URL to run guest order API contract tests against a real backend.');

  const baseOrder = (paymentMethod: string) => ({
    email: `guest+${paymentMethod}+${Date.now()}@example.com`,
    phone: '9876543210',
    shippingAddress: {
      fullName: 'Guest Buyer',
      addressLine1: '123 Guest St',
      city: 'Guest City',
      state: 'Guest State',
      postalCode: '123456',
      country: 'India',
      phone: '9876543210',
    },
    paymentMethod,
    items: [{ product: process.env.E2E_TEST_PRODUCT_ID, quantity: 1, price: 1000 }],
    subtotal: 1000,
    tax: 0,
    shippingCost: 0,
    discount: 0,
    totalAmount: 1000,
  });

  for (const method of ['cod', 'razorpay']) {
    test(`POST /orders/guest creates a guest order (${method})`, async () => {
      test.skip(!process.env.E2E_TEST_PRODUCT_ID, 'Set E2E_TEST_PRODUCT_ID to a real in-stock product _id.');
      const api = await playwrightRequest.newContext({ baseURL: BACKEND });
      const res = await api.post('/orders/guest', { data: baseOrder(method) });
      expect(res.status(), await res.text()).toBe(201);
      const body = await res.json();
      expect(body.success).toBeTruthy();
      expect(body.isGuest).toBeTruthy();
      expect(body.order?._id).toBeTruthy();
      await api.dispose();
    });
  }
});
