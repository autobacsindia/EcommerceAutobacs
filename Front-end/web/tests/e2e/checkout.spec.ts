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
    // 1. Go to products
    await page.goto('/products');
    
    // 2. Add first product to cart
    // Wait for products to load
    await page.waitForSelector('button:has-text("Add")');
    const addButtons = await page.$$('button:has-text("Add")');
    if (addButtons.length > 0) {
      await addButtons[0].click();
    } else {
      throw new Error('No products found to add to cart');
    }
    
    // Assert toast or cart count update (optional, but good for stability)
    // For now, just wait a bit or check cart icon count if possible.
    // Easier: Go to cart and check if item is there.
    
    // 3. Go to Cart
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
