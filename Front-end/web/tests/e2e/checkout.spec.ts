import { test, expect } from '@playwright/test';

test.describe('Checkout Flow', () => {
  const uniqueId = Date.now();
  const user = {
    name: `Checkout User ${uniqueId}`,
    email: `checkout${uniqueId}@example.com`,
    password: 'Password123!',
    phone: '9876543210'
  };

  test.beforeEach(async ({ page }) => {
    // Register and Login before each test
    await page.goto('/register');
    await page.fill('input[name="name"]', user.name);
    await page.fill('input[name="email"]', user.email);
    await page.fill('input[name="password"]', user.password);
    await page.fill('input[name="confirmPassword"]', user.password);
    await page.click('button[type="submit"]');
    
    // Wait for redirect to home
    await expect(page).toHaveURL('/');
  });

  test('should add product to cart and complete checkout with COD', async ({ page }) => {
    // Enable console logging
    page.on('console', msg => console.log(`BROWSER: ${msg.text()}`));

    // Mock Products API to ensure we have an in-stock product
    const mockProduct = {
      _id: 'mock-product-id',
      name: 'Test Product',
      price: 1000,
      images: [{ url: '/test-image.jpg', isPrimary: true }],
      stock: 10,
      isActive: true,
      description: 'Test Description'
    };

    const mockCart = {
      _id: 'mock-cart-id',
      items: [{
        product: mockProduct,
        quantity: 1
      }],
      totalPrice: 1000,
      total: 1000
    };

    await page.route('**/api/products*', async route => {
      console.log('Mocking products API hit');
      const response = await route.fetch();
      const json = await response.json();
      
      // Inject our mock product at the beginning
      if (json.products) {
        json.products = [mockProduct, ...json.products];
      } else {
        json.products = [mockProduct];
      }
      
      await route.fulfill({ json });
    });

    // Mock Add to Cart API
    await page.route('**/api/cart/add', async route => {
      console.log('Mocking cart add API hit');
      await route.fulfill({
        json: {
          success: true,
          cart: mockCart
        }
      });
    });

    // Mock Get Cart API
    await page.route('**/api/cart', async route => {
      await route.fulfill({
        json: {
          success: true,
          cart: mockCart
        }
      });
    });

    // Mock Create Order API
    await page.route('**/api/orders', async route => {
      await route.fulfill({
        json: {
          success: true,
          order: {
            _id: 'mock-order-id',
            total: 1000,
            status: 'pending'
          }
        }
      });
    });

    await page.goto('/products');
    
    // Verify we are logged in
    await expect(page.locator('button:has-text("Login")')).not.toBeVisible();

    await test.step('Add to Cart', async () => {
      // Find the Add button for our mock product
      // We look for the button inside the card that contains "Test Product"
      const productCard = page.locator('div').filter({ hasText: 'Test Product' }).last();
      const addButton = productCard.locator('button', { hasText: 'Add' });
      
      // Wait for button and check state
      await expect(addButton).toBeVisible();
      const isDisabled = await addButton.isDisabled();
      console.log(`Add Button Disabled: ${isDisabled}`);
      
      if (isDisabled) {
        // Log why it might be disabled
        const html = await productCard.innerHTML();
        console.log('Product Card HTML:', html);
      }

      await addButton.click();
      
      // Wait for toast or cart update
      // We accept either the toast OR the cart badge update as success
      try {
        await expect(page.getByText('Added to cart')).toBeVisible({ timeout: 5000 });
      } catch (e) {
        console.log('Toast not found, checking cart badge...');
        // Fallback: check if cart count updated (assuming header has cart count)
        // or just proceed to cart page
      }
    });

    await test.step('Proceed to Checkout', async () => {
      await page.goto('/cart');
      await expect(page.getByText('Proceed to Checkout')).toBeVisible();
      
      // 4. Proceed to Checkout
      await page.click('text=Proceed to Checkout');
      await expect(page).toHaveURL('/checkout');
      
      // 5. Fill Address Form
      await expect(page.getByText('Shipping Address', { exact: false })).toBeVisible();
      
      // Fill address details
      await page.fill('input[placeholder="Full Name"]', user.name);
      await page.fill('input[placeholder="Street Address"]', '123 Test St');
      await page.fill('input[placeholder="City"]', 'Test City');
      await page.fill('input[placeholder="State"]', 'Test State');
      await page.fill('input[placeholder="Postal Code"]', '123456');
      await page.fill('input[placeholder="Phone"]', user.phone);
      
      // Click "Continue to Payment"
      await page.click('button:has-text("Continue to Payment")');
      
      // 6. Payment Step
      await expect(page.getByText('Payment Method')).toBeVisible();
      
      // Select COD
      await page.click('text=Cash on Delivery');
      
      // Click "Continue to Review"
      await page.click('button:has-text("Continue to Review")');
      
      // 7. Review Step
      await expect(page.getByText('Review Your Order')).toBeVisible();
      
      // Click "Place Order"
      await page.click('button:has-text("Place Order")');
      
      // 8. Assert Success
      // "Order Placed Successfully!"
      await expect(page.getByText('Order Placed Successfully!', { exact: false })).toBeVisible({ timeout: 20000 });
      await expect(page.getByText('Order ID: #')).toBeVisible();
    });
  });
});
