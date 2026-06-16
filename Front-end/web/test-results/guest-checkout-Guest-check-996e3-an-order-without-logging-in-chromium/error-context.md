# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: guest-checkout.spec.ts >> Guest checkout (UI, mocked network) >> guest cart -> checkout -> Razorpay places an order without logging in
- Location: tests/e2e/guest-checkout.spec.ts:43:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('Guest Test Product')
Expected: visible
Timeout: 30000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 30000ms
  - waiting for getByText('Guest Test Product')

```

```yaml
- banner:
  - link "Roavion":
    - /url: /
    - img "Roavion"
  - button "Change delivery location": Deliver to Select your location
  - textbox "Search products, brands, categories..."
  - button "Search"
  - button "Select currency": INR
  - link "Login":
    - /url: /login
  - link "Sign Up":
    - /url: /register
  - link:
    - /url: /wishlist
  - link "Cart":
    - /url: /cart
  - navigation:
    - link "Shop":
      - /url: /shop
    - link "Brand":
      - /url: /brands
    - button "Vehicle ▼"
    - link "Accessories":
      - /url: /categories/accessories
    - link "Exterior":
      - /url: /categories/exterior
    - link "Interior":
      - /url: /categories/interior
    - link "Body Kits":
      - /url: /categories/bodykit
    - link "Performance":
      - /url: /categories/performance
    - link "Suspension":
      - /url: /categories/suspension
    - link "Audio":
      - /url: /categories/audio
    - link "Lights":
      - /url: /categories/lights
    - link "Offers":
      - /url: /offers
- main:
  - paragraph: Catalogue
  - heading "Our Products" [level=1]
  - paragraph: Explore our premium collection of automotive accessories and performance parts
  - paragraph: No products found
  - checkbox "Show all"
  - text: Show all
  - combobox:
    - option "Newest First" [selected]
    - 'option "Price: Low → High"'
    - 'option "Price: High → Low"'
    - 'option "Name: A – Z"'
    - option "Highest Rated"
  - complementary:
    - heading "Filters" [level=2]
    - heading "Categories" [level=3]
    - button "Expand categories": +
    - heading "Brands" [level=3]
    - button "Expand brands": +
    - heading "Price Range" [level=3]
    - slider: "100000"
    - text: ₹0 ₹1,00,000
    - button "Apply"
    - heading "Availability" [level=3]
    - checkbox "In Stock Only"
    - text: In Stock Only
    - heading "Rating" [level=3]
    - checkbox "4 & up"
    - text: "4"
    - img
    - text: "& up"
    - checkbox "3 & up"
    - text: "3"
    - img
    - text: "& up"
    - checkbox "2 & up"
    - text: "2"
    - img
    - text: "& up"
    - checkbox "1 & up"
    - text: "1"
    - img
    - text: "& up"
  - img
  - heading "Session Expired" [level=3]
  - paragraph: Your session has expired. Please log in again to continue.
  - button "Log In":
    - img
    - text: Log In
  - button "Refresh Page"
  - paragraph:
    - strong: "Technical Details:"
  - paragraph: "Error:"
  - paragraph: "Status: 403"
  - paragraph: "Category: auth"
  - paragraph: "URL: http://localhost:3000/api/v1/products"
- contentinfo:
  - heading "Autobacs India" [level=3]
  - paragraph: Premium automotive accessories and performance parts for your car.
  - link:
    - /url: "#"
  - link:
    - /url: "#"
  - link:
    - /url: "#"
  - link:
    - /url: "#"
  - heading "Company" [level=4]
  - list:
    - listitem:
      - link "About Us":
        - /url: /about
    - listitem:
      - link "Contact":
        - /url: /contact
    - listitem:
      - link "Careers":
        - /url: /careers
    - listitem:
      - link "News":
        - /url: /media/news
    - listitem:
      - link "Blog":
        - /url: /media/blogs
  - heading "Support" [level=4]
  - list:
    - listitem:
      - link "FAQ":
        - /url: /faq
    - listitem:
      - link "Shipping Info":
        - /url: /shipping
    - listitem:
      - link "Returns":
        - /url: /returns
    - listitem:
      - link "Warranty":
        - /url: /warranty
  - heading "Legal" [level=4]
  - list:
    - listitem:
      - link "Privacy Policy":
        - /url: /privacy
    - listitem:
      - link "Terms of Service":
        - /url: /terms
    - listitem:
      - link "Refund Policy":
        - /url: /returns
  - paragraph: © 2026 Roavion Private LTD. All rights reserved.
  - text: SSL Secured Verified
- alert
- button "Open issues overlay":
  - img
  - text: 13 Issue
- button "Collapse issues badge":
  - img
```

# Test source

```ts
  22  |   name: 'Guest Test Product',
  23  |   price: 1000,
  24  |   description: 'Guest Test Description',
  25  |   images: [{ url: 'https://placehold.co/200x200.png', isPrimary: true }],
  26  |   category: { _id: 'cat1', name: 'Test Category' },
  27  |   brand: { _id: 'brand1', name: 'Test Brand' },
  28  |   stock: 10,
  29  |   specifications: [],
  30  |   compatibility: [],
  31  |   isActive: true,
  32  |   createdAt: new Date().toISOString(),
  33  | };
  34  | 
  35  | const mockCart = {
  36  |   _id: 'guest-mock-cart-id',
  37  |   items: [{ product: mockProduct, quantity: 1 }],
  38  |   totalPrice: 1000,
  39  |   total: 1000,
  40  | };
  41  | 
  42  | test.describe('Guest checkout (UI, mocked network)', () => {
  43  |   test('guest cart -> checkout -> Razorpay places an order without logging in', async ({ page }) => {
  44  |     // Silence images.
  45  |     await page.route('**/*.{png,jpg,jpeg,webp,svg}', route =>
  46  |       route.fulfill({ status: 200, body: 'mock-image', contentType: 'image/png' }));
  47  |     await page.route('**/_next/image*', route =>
  48  |       route.fulfill({ status: 200, body: 'mock-image', contentType: 'image/png' }));
  49  | 
  50  |     // Force GUEST: /auth/me must NOT return a user.
  51  |     await page.route('**/api/auth/me', route =>
  52  |       route.fulfill({ status: 401, json: { success: false, message: 'Not authenticated' } }));
  53  | 
  54  |     // Product listing — inject our in-stock product.
  55  |     await page.route('**/api/products*', async route => {
  56  |       const response = await route.fetch();
  57  |       let json: any = {};
  58  |       try { json = await response.json(); } catch { json = {}; }
  59  |       json.products = [mockProduct, ...(json.products || [])];
  60  |       await route.fulfill({ json });
  61  |     });
  62  | 
  63  |     // Cart endpoints (session-based for guests).
  64  |     await page.route('**/api/cart/add', route =>
  65  |       route.fulfill({ json: { success: true, cart: mockCart } }));
  66  |     await page.route('**/api/cart/validate', route =>
  67  |       route.fulfill({
  68  |         json: {
  69  |           success: true,
  70  |           isValid: true,
  71  |           subtotal: 1000,
  72  |           tax: 0,
  73  |           total: 1000,
  74  |           items: [{ productId: mockProduct._id, quantity: 1, unitPrice: 1000 }],
  75  |         },
  76  |       }));
  77  |     await page.route('**/api/cart', route =>
  78  |       route.fulfill({ json: { success: true, cart: mockCart } }));
  79  | 
  80  |     // Guest order creation — note the /orders/guest endpoint, not /orders.
  81  |     await page.route('**/api/orders/guest', route =>
  82  |       route.fulfill({
  83  |         status: 201,
  84  |         json: {
  85  |           success: true,
  86  |           isGuest: true,
  87  |           magicLinkToken: 'mock-magic-token',
  88  |           order: { _id: 'guest-mock-order-id', orderNumber: 'AB-GUEST-1', totalAmount: 1000, status: 'pending' },
  89  |         },
  90  |       }));
  91  | 
  92  |     // Razorpay backend endpoints.
  93  |     await page.route('**/api/razorpay/create-order', route =>
  94  |       route.fulfill({
  95  |         json: { success: true, data: { id: 'rzp_order_mock', amount: 100000, currency: 'INR', orderId: 'rzp_order_mock' } },
  96  |       }));
  97  |     await page.route('**/api/razorpay/verify-payment', route =>
  98  |       route.fulfill({ json: { success: true, orderId: 'guest-mock-order-id' } }));
  99  | 
  100 |     // Noise reducers.
  101 |     await page.route('**/api/wishlist', route => route.fulfill({ json: { success: true, wishlist: [] } }));
  102 |     await page.route('**/api/categories*', route => route.fulfill({ json: { success: true, categories: [] } }));
  103 |     await page.route('**/api/brands*', route => route.fulfill({ json: { success: true, brands: [] } }));
  104 | 
  105 |     // Razorpay SDK mock — succeed immediately.
  106 |     await page.addInitScript(() => {
  107 |       (window as any).Razorpay = function (options: any) {
  108 |         this.open = function () {
  109 |           options.handler?.({
  110 |             razorpay_payment_id: 'pay_mock_123',
  111 |             razorpay_order_id: options.order_id,
  112 |             razorpay_signature: 'sig_mock_123',
  113 |           });
  114 |         };
  115 |         this.on = function () {};
  116 |       };
  117 |     });
  118 | 
  119 |     await page.goto('/products');
  120 | 
  121 |     // Confirm we are a guest (a Login affordance should still be reachable).
> 122 |     await expect(page.getByText('Guest Test Product')).toBeVisible();
      |                                                        ^ Error: expect(locator).toBeVisible() failed
  123 | 
  124 |     await test.step('Add to cart', async () => {
  125 |       const productCard = page.locator('div').filter({ hasText: 'Guest Test Product' }).last();
  126 |       const addButton = productCard.locator('button', { hasText: 'Add' });
  127 |       await expect(addButton).toBeVisible();
  128 |       await addButton.click();
  129 |     });
  130 | 
  131 |     await test.step('Checkout as guest -> Razorpay', async () => {
  132 |       await page.goto('/cart', { waitUntil: 'domcontentloaded' });
  133 |       await expect(page.getByText('Proceed to Checkout')).toBeVisible();
  134 |       await page.click('text=Proceed to Checkout');
  135 | 
  136 |       // Step: cart review
  137 |       await expect(page.getByText('Review Your Cart')).toBeVisible();
  138 |       await page.click('text=Continue to Shipping');
  139 | 
  140 |       // Step: shipping address — guest contact fields appear here.
  141 |       await expect(page.getByText('Shipping Address')).toBeVisible();
  142 |       await page.fill('input[placeholder="your@email.com"]', `guest${Date.now()}@example.com`);
  143 |       await page.fill('input[placeholder="Full Name"]', 'Guest Buyer');
  144 |       await page.fill('input[placeholder="Street Address"]', '123 Guest St');
  145 |       await page.fill('input[placeholder="City"]', 'Guest City');
  146 |       await page.fill('input[placeholder="State"]', 'Guest State');
  147 |       await page.fill('input[placeholder="Postal Code"]', '123456');
  148 |       await page.fill('input[placeholder="Phone"]', '9876543210');
  149 |       await page.click('button:has-text("Continue to Payment")');
  150 | 
  151 |       // Step: payment (Razorpay is the only method today)
  152 |       await expect(page.getByText('Payment Method')).toBeVisible();
  153 |       await page.click('button:has-text("Continue to Review")');
  154 | 
  155 |       // Step: review
  156 |       await expect(page.getByText('Review Your Order')).toBeVisible();
  157 |       await page.click('button:has-text("Place Order")');
  158 | 
  159 |       // Confirmation
  160 |       await expect(page.getByText('Order Placed!', { exact: false })).toBeVisible({ timeout: 20000 });
  161 |     });
  162 |   });
  163 | });
  164 | 
  165 | /**
  166 |  * Real-backend guest order contract. Opt-in: set E2E_BACKEND_URL to the API
  167 |  * base (e.g. http://localhost:5000/api or a staging URL). Skipped otherwise so
  168 |  * the default `npm run test:e2e` stays hermetic.
  169 |  *
  170 |  * Covers the roadmap's "COD and Razorpay" requirement at the layer where COD
  171 |  * actually exists (the Order/Payment models accept paymentMethod 'cod'; the UI
  172 |  * does not yet expose it).
  173 |  */
  174 | const BACKEND = process.env.E2E_BACKEND_URL;
  175 | 
  176 | test.describe('Guest order API contract (real backend)', () => {
  177 |   test.skip(!BACKEND, 'Set E2E_BACKEND_URL to run guest order API contract tests against a real backend.');
  178 | 
  179 |   const baseOrder = (paymentMethod: string) => ({
  180 |     email: `guest+${paymentMethod}+${Date.now()}@example.com`,
  181 |     phone: '9876543210',
  182 |     shippingAddress: {
  183 |       fullName: 'Guest Buyer',
  184 |       addressLine1: '123 Guest St',
  185 |       city: 'Guest City',
  186 |       state: 'Guest State',
  187 |       postalCode: '123456',
  188 |       country: 'India',
  189 |       phone: '9876543210',
  190 |     },
  191 |     paymentMethod,
  192 |     items: [{ product: process.env.E2E_TEST_PRODUCT_ID, quantity: 1, price: 1000 }],
  193 |     subtotal: 1000,
  194 |     tax: 0,
  195 |     shippingCost: 0,
  196 |     discount: 0,
  197 |     totalAmount: 1000,
  198 |   });
  199 | 
  200 |   for (const method of ['cod', 'razorpay']) {
  201 |     test(`POST /orders/guest creates a guest order (${method})`, async () => {
  202 |       test.skip(!process.env.E2E_TEST_PRODUCT_ID, 'Set E2E_TEST_PRODUCT_ID to a real in-stock product _id.');
  203 |       const api = await playwrightRequest.newContext({ baseURL: BACKEND });
  204 |       const res = await api.post('/orders/guest', { data: baseOrder(method) });
  205 |       expect(res.status(), await res.text()).toBe(201);
  206 |       const body = await res.json();
  207 |       expect(body.success).toBeTruthy();
  208 |       expect(body.isGuest).toBeTruthy();
  209 |       expect(body.order?._id).toBeTruthy();
  210 |       await api.dispose();
  211 |     });
  212 |   }
  213 | });
  214 | 
```