# Razorpay Payment Integration

## Overview
This document describes the Razorpay payment integration for the Autobacs e-commerce platform. The integration enables customers to make secure online payments using various payment methods supported by Razorpay.

## Components Implemented

### Backend
1. **Razorpay Service** (`services/razorpayService.js`)
   - Handles Razorpay order creation
   - Verifies payment signatures
   - Processes successful payments
   - Handles webhook events
   - Updates order status upon successful payment

2. **Razorpay Routes** (`routes/razorpay.js`)
   - `POST /razorpay/create-order` - Create Razorpay order
   - `POST /razorpay/verify-payment` - Verify payment and update order
   - `POST /razorpay/webhook` - Handle Razorpay webhook events

3. **Configuration**
   - Environment variables for API keys
   - Updated `.env.example` with Razorpay configuration

### Frontend
1. **Checkout Page** (`src/app/checkout/page.tsx`)
   - Added Razorpay as payment option
   - Integrated Razorpay checkout SDK
   - Handles payment success and failure callbacks

2. **Configuration**
   - Added `NEXT_PUBLIC_RAZORPAY_KEY_ID` to `.env.local`
   - Created `.env.example` for frontend environment variables

## Setup Instructions

### 1. Backend Setup
1. Ensure Razorpay SDK is installed:
   ```bash
   npm install razorpay
   ```

2. Add the following environment variables to `.env`:
   ```
   RAZORPAY_KEY_ID=your_razorpay_key_id_here
   RAZORPAY_KEY_SECRET=your_razorpay_key_secret_here
   ```

3. Test the integration:
   ```bash
   npm run test-razorpay
   ```

### 2. Frontend Setup
1. Add the following environment variable to `.env.local`:
   ```
   NEXT_PUBLIC_RAZORPAY_KEY_ID=your_razorpay_key_id_here
   ```

## API Endpoints

### Create Razorpay Order
```
POST /razorpay/create-order
Authorization: Bearer <token>
Content-Type: application/json

{
  "orderId": "string",           // Internal order ID
  "amount": "number",            // Amount in smallest currency unit (paise for INR)
  "currency": "string",          // Default: "INR"
  "receipt": "string"            // Order receipt identifier
}
```

### Verify Payment
```
POST /razorpay/verify-payment
Authorization: Bearer <token>
Content-Type: application/json

{
  "razorpay_order_id": "string",
  "razorpay_payment_id": "string",
  "razorpay_signature": "string"
}
```

### Webhook Handler
```
POST /razorpay/webhook
Content-Type: application/json
X-Razorpay-Signature: <signature>

// Razorpay webhook payload
```

## Security Considerations

1. **Credential Management**
   - `RAZORPAY_KEY_ID` is used in frontend (public)
   - `RAZORPAY_KEY_SECRET` is used only in backend (private)
   - Never expose secret key to frontend

2. **Payment Verification**
   - All payments are verified using HMAC SHA256 signatures
   - Server-side verification prevents tampering

3. **PCI Compliance**
   - Uses Razorpay's hosted checkout to avoid handling card data directly
   - Never logs or stores sensitive payment information

## Testing

### Backend Tests
Run the Razorpay service test:
```bash
npm run test-razorpay
```

### Manual Testing
1. Place an order using Razorpay as payment method
2. Complete payment on Razorpay checkout page
3. Verify order status is updated to "confirmed"
4. Check payment record is created in database

## Troubleshooting

### Common Issues

1. **"Razorpay credentials not configured"**
   - Ensure `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` are set in `.env`

2. **Payment verification fails**
   - Check that the secret key matches exactly
   - Verify the webhook signature algorithm

3. **Frontend SDK not loading**
   - Check network connectivity to `checkout.razorpay.com`
   - Verify `NEXT_PUBLIC_RAZORPAY_KEY_ID` is correctly set

## Future Enhancements

1. Save cards functionality using Razorpay's token vault
2. EMI payment options
3. International payment support
4. Payment analytics dashboard
5. Retry mechanism for failed payments