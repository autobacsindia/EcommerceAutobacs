# 🧪 Guest Checkout - Live Testing Guide

## ✅ Servers Status
- Backend: ✅ Running on http://localhost:8080
- Frontend: ✅ Running on http://localhost:3000

---

## Test 1: Guest Checkout Flow (Complete End-to-End)

### Step 1: Navigate to Homepage
```
Open browser → http://localhost:3000
```
**Expected:** See Autobacs homepage with products

### Step 2: Add Product to Cart
```
1. Browse products or search for any item
2. Click "Add to Cart" on any product
3. You should see cart count update
```
**Expected:** Toast notification: "Added to cart"

### Step 3: Go to Checkout
```
Click cart icon → "Checkout" button
```
**Expected:** Redirected to `/checkout` page

### Step 4: Verify Guest Mode
```
Check if you see:
✅ Email input field
✅ Phone input field  
✅ "Quick Checkout: No account needed!" message
❌ NO login prompt
```

**Screenshot Check:** You should see a gray box at the top with:
- 📧 Contact Information heading
- Email input with placeholder "your@email.com"
- Phone input with placeholder "+91 98765 43210"
- Blue info box: "✨ Quick Checkout: No account needed!..."

### Step 5: Enter Guest Details
```
Email: test@example.com
Phone: +91 99999 88888
```

### Step 6: Fill Shipping Address
```
Full Name: Test User
Address Line 1: 123 Test Street
City: Bangalore
State: Karnataka
Postal Code: 560001
Country: India
Phone: +91 99999 88888
```

### Step 7: Select Payment Method
```
Choose: Cash on Delivery (COD)
```

### Step 8: Place Order
```
Click "Place Order" button
```

### Expected Results:
✅ Order created successfully  
✅ Toast: "Order placed successfully!"  
✅ Redirected to confirmation page  
✅ See purple/blue gradient box: "🎉 Claim Your Account!"  
✅ Button: "🚀 Claim My Account Now"

### Step 9: Check Browser Console (F12)
```
Open DevTools → Console tab
```

**Expected Log:**
```
🔑 DEBUG TOKEN (development only): abc123xyz...
Toast: Debug token logged to console
```

**Copy this token for next step!**

---

## Test 2: Claim Account via URL

### Step 1: Click "Claim My Account Now"
```
From confirmation page, click the purple button
```

**Expected:** Navigate to `/claim-order?orderId=ORDER_ID`

### Step 2: Verify Auto-Fill
```
Check if token is auto-filled in the input field
```

**Expected:** Token input should be pre-populated (from URL param)

### Step 3: Set Password (Optional)
```
Enter password: testpass123
(Or leave blank for passwordless login)
```

### Step 4: Verify & Claim
```
Click "🔓 Verify & Claim Account" button
```

### Expected Results:
✅ Success screen appears  
✅ Green checkmark animation  
✅ Message: "Account claimed successfully!"  
✅ Progress bar shows completion  
✅ Auto-redirect to `/orders/ORDER_ID` after 2 seconds

### Step 5: Verify Login State
```
After redirect, check localStorage:
1. Open DevTools → Application tab
2. Expand "Local Storage"
3. Click on your domain
4. Look for key: "auth_token"
```

**Expected:** Should contain a JWT token (starts with "eyJ...")

### Step 6: Verify Order Access
```
You should now see order details page with:
- Order number
- Items list
- Total amount
- Order status
```

---

## Test 3: Request New Magic Link (Manual)

### Scenario A: Lost Email / Need Resend

**Step 1: Navigate to Claim Page**
```
Go to: http://localhost:3000/claim-order
```

**Step 2: Enter Email**
```
Email: test@example.com
Leave Order ID blank (optional)
Click "📧 Send Magic Link"
```

**Expected:**
✅ Form switches to verify step  
✅ Toast: "Magic link sent! Check your email/SMS."  
✅ Console shows debug token (dev mode only)

**Step 3: Copy Token from Console**
```
Check console for:
🔑 DEBUG TOKEN (development only): xxxxx
```

**Step 4: Verify Token**
```
Paste token into input field
Click "Verify & Claim Account"
```

**Expected:** Same success flow as Test 2

---

## Test 4: Invalid Token Handling

### Step 1: Enter Fake Token
```
Token: fake_token_12345
Click "Verify & Claim Account"
```

**Expected:**
❌ Red error toast: "Invalid or expired link"  
✅ Form remains open for retry  
✅ No redirect

---

## Test 5: Existing User Login (Should NOT See Guest Form)

### Step 1: Logout (if logged in)
```
Click profile icon → "Logout"
```

### Step 2: Add Item to Cart & Checkout
```
Add product → Go to checkout
```

**Expected:**
❌ NO guest contact form visible  
✅ Should show login prompt OR address form directly (if already authenticated)

### Step 3: Verify Redirect
```
If not logged in, should redirect to /login
```

---

## Test 6: Mobile Responsiveness

### Test on Mobile Viewport
```
DevTools → Toggle Device Toolbar (Ctrl+Shift+M)
Select: iPhone 12 Pro or Pixel 5
```

**Check:**
✅ Contact form fits on screen  
✅ Input fields are tappable size  
✅ Buttons are easily clickable  
✅ Text is readable without zooming  
✅ No horizontal scrolling

---

## Common Issues & Solutions

### Issue 1: "Failed to place order"

**Possible Causes:**
1. Backend not running
2. Empty cart
3. Missing required fields

**Debug Steps:**
```javascript
// Check network tab
DevTools → Network → Filter: "/orders/guest"
Click request → Response tab
```

**Expected Response:**
```json
{
  "success": true,
  "order": { "_id": "...", "totalAmount": 1234 },
  "isGuest": true,
  "magicLinkToken": "xxx" // Dev only
}
```

### Issue 2: No Debug Token in Console

**Cause:** Backend not in development mode

**Solution:**
```bash
# Check backend .env
NODE_ENV=development
```

**Workaround:** Use magic link from email instead

### Issue 3: Claim Page Shows Blank

**Cause:** TypeScript compilation error

**Solution:**
```bash
cd Front-end/web
npm run dev
# Check terminal for errors
```

### Issue 4: Infinite Loading Spinner

**Cause:** API endpoint mismatch

**Debug:**
```javascript
// Check .env.local
NEXT_PUBLIC_API_URL=http://localhost:8080
```

---

## Success Criteria Checklist

Use this checklist to verify everything works:

- [ ] Guest can enter email/phone at checkout
- [ ] Guest can fill shipping address
- [ ] Order creates successfully for guest user
- [ ] Confirmation page shows "Claim Account" section
- [ ] Magic link token appears in console (dev mode)
- [ ] Claim page loads with auto-filled token
- [ ] Token verification succeeds
- [ ] User gets logged in automatically
- [ ] Redirects to order page
- [ ] Order details visible to new user
- [ ] Auth token stored in localStorage
- [ ] Existing users don't see guest form
- [ ] Invalid tokens show proper error
- [ ] Mobile view works correctly
- [ ] No console errors during flow
- [ ] Email sends successfully (if SendGrid configured)

---

## Performance Benchmarks

Time each action (use stopwatch or DevTools Performance tab):

| Action | Target | Actual |
|--------|--------|--------|
| Guest order creation | < 500ms | _____ ms |
| Magic link request | < 300ms | _____ ms |
| Token verification | < 100ms | _____ ms |
| Page load time | < 2s | _____ s |
| Total checkout time | < 3 min | _____ min |

---

## Next Steps After Testing

### If All Tests Pass ✅
1. Deploy to staging environment
2. Test with real email addresses
3. Configure SendGrid for production
4. Run user acceptance testing (UAT)
5. Schedule production deployment

### If Tests Fail ❌
1. Document the failing test
2. Capture screenshots/video
3. Check browser console errors
4. Review network requests
5. Share error details for debugging

---

## Report Template

Use this template to report test results:

```markdown
## Test Results - [DATE]

**Tester:** [Your name]
**Environment:** Local (localhost:3000/8080)
**Browser:** Chrome/Firefox/Safari

### Tests Passed:
- [x] Test 1: Guest Checkout
- [x] Test 2: Claim Account
- [ ] Test 3: Magic Link Request (blocked by...)
- [x] Test 4: Invalid Token
- [x] Test 5: Existing User
- [x] Test 6: Mobile Responsive

### Issues Found:
1. **Issue:** [Description]
   **Severity:** High/Medium/Low
   **Steps to Reproduce:** ...
   **Screenshot:** [Attach if available]

### Performance Metrics:
- Order creation: 320ms ✅
- Token verification: 89ms ✅
- Total checkout: 2m 15s ✅

### Overall Status:** PASS/FAIL
```

---

## Ready to Test? 🚀

Open your browser and start with **Test 1: Guest Checkout Flow**

Good luck! Let me know if you encounter any issues.
