# Razorpay Integration Setup Guide

## Overview
The Razorpay integration has been implemented in both Frontend and Backend. 
To make it fully functional, you need to provide valid Razorpay API keys.

## Configuration Steps

### 1. Get Razorpay Keys
1. Log in to your [Razorpay Dashboard](https://dashboard.razorpay.com/).
2. Go to **Settings** -> **API Keys**.
3. Generate a **Test Key** for development.
4. Note down the `Key ID` and `Key Secret`.

### 2. Update Backend Configuration
Edit `c:\Main project\Autobacs\Back-end\server\.env`:

```env
RAZORPAY_KEY_ID=your_actual_key_id_here
RAZORPAY_KEY_SECRET=your_actual_key_secret_here
```

### 3. Update Frontend Configuration
Edit `c:\Main project\Autobacs\Front-end\web\.env.local`:

```env
NEXT_PUBLIC_RAZORPAY_KEY_ID=your_actual_key_id_here
```
*Note: The Key ID must match the one in the Backend .env file.*

## Testing the Integration

1. **Restart Servers**:
   - Restart the Backend server (`npm start` or `npm run dev`).
   - Restart the Frontend server (`npm run dev`).

2. **Flow**:
   - Add items to Cart.
   - Proceed to Checkout.
   - Fill in shipping details.
   - Select "Razorpay" (or "Online Payment") as payment method.
   - Click "Place Order".
   - The Razorpay payment modal should appear.
   - Complete payment (use Razorpay [Test Card Details](https://razorpay.com/docs/payments/payments/test-card-data/)).
   - You should be redirected to the Order Confirmation page.

## Troubleshooting

- **"Razorpay credentials not configured"**: Check Backend `.env`.
- **Payment Modal doesn't open**: Check Frontend `.env.local` and browser console for errors.
- **Verification Failed**: Ensure `RAZORPAY_KEY_SECRET` in Backend matches the one generated with the Key ID.
