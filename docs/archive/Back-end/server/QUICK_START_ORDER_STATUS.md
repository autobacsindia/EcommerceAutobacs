# Quick Start: Order Status Management

## 🚀 Getting Started

### Prerequisites
- MongoDB running
- Server dependencies installed (`npm install`)
- Admin and customer user accounts created

### 1. Test the System

Run the automated test suite:
```bash
cd "c:\Main project\Autobacs\Back-end\server"
node test-order-status.js
```

Expected output:
```
✓ PASS: Status Transition Validation
✓ PASS: Valid Next Statuses
✓ PASS: Update Order Status
✓ PASS: Status History Tracking
✓ PASS: Fulfillment Metrics
✓ PASS: Status Statistics

🎉 All tests passed!
```

### 2. Create a Test Order

Use Postman or your API client:

```http
POST http://localhost:5000/orders
Authorization: Bearer <customer_token>
Content-Type: application/json

{
  "items": [
    {
      "product": "product_id_here",
      "quantity": 2
    }
  ],
  "shippingAddress": {
    "fullName": "John Doe",
    "phone": "9876543210",
    "addressLine1": "123 Main St",
    "city": "Mumbai",
    "state": "Maharashtra",
    "postalCode": "400001"
  },
  "shippingCost": 50,
  "tax": 180
}
```

### 3. Update Order Status (Admin)

```http
PUT http://localhost:5000/orders/{order_id}/status
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "status": "confirmed",
  "reason": "payment_verified",
  "notes": "Payment received successfully"
}
```

### 4. View Status History

```http
GET http://localhost:5000/orders/{order_id}/status-history
Authorization: Bearer <token>
```

### 5. Check Valid Transitions

```http
GET http://localhost:5000/orders/{order_id}/valid-transitions
Authorization: Bearer <token>
```

## 📊 Common Workflows

### Customer Workflow

1. **Create Order** → Status: `pending`
2. **Cancel Order** (if needed):
```http
PUT http://localhost:5000/orders/{order_id}/cancel
Authorization: Bearer <customer_token>

{
  "reason": "customer_request",
  "notes": "Changed my mind"
}
```

### Admin Workflow

1. **Confirm Payment** → `pending` to `confirmed`:
```http
PUT /orders/{order_id}/status
{
  "status": "confirmed",
  "reason": "payment_verified"
}
```

2. **Start Processing** → `confirmed` to `processing`:
```http
PUT /orders/{order_id}/status
{
  "status": "processing",
  "reason": "warehouse_assigned"
}
```

3. **Mark as Shipped** → `processing` to `shipped`:
```http
PUT /orders/{order_id}/status
{
  "status": "shipped",
  "reason": "handed_to_carrier",
  "trackingNumber": "TRACK123456"
}
```

4. **Mark as Delivered** → `shipped` to `delivered`:
```http
PUT /orders/{order_id}/status
{
  "status": "delivered",
  "reason": "customer_received"
}
```

## 📈 Analytics Endpoints (Admin)

### Status Statistics
```http
GET http://localhost:5000/orders/analytics/status-stats
Authorization: Bearer <admin_token>
```

### Fulfillment Metrics
```http
GET http://localhost:5000/orders/analytics/fulfillment-metrics
Authorization: Bearer <admin_token>
```

### With Date Filters
```http
GET http://localhost:5000/orders/analytics/status-stats?startDate=2024-12-01&endDate=2024-12-31
```

## 🔍 Troubleshooting

### Error: "Cannot transition from X to Y"
- Check the status transition rules in `ORDER_STATUS_MANAGEMENT.md`
- Use the `/valid-transitions` endpoint to see allowed transitions

### Error: "Admin permission required"
- Some transitions (like cancelling after processing) require admin role
- Verify your JWT token has `role: "admin"`

### Error: "Invalid reason"
- Each status has specific valid reasons
- Use the `/valid-transitions` endpoint to see valid reasons
- Check `ORDER_STATUS_MANAGEMENT.md` for complete list

### Status History Not Showing Users
- Ensure the `updatedBy` field is properly set
- User must exist in the database
- Check MongoDB connection

## 📚 Reference

### Valid Status Flow
```
pending → confirmed → processing → shipped → delivered
   ↓          ↓            ↓
cancelled  cancelled    cancelled*
                        (*admin only)

delivered → refunded (admin only)
```

### Status Codes
- `pending` - Order created
- `confirmed` - Payment verified
- `processing` - Being prepared
- `shipped` - Sent to customer
- `delivered` - Received by customer
- `cancelled` - Order cancelled
- `refunded` - Payment refunded

### Reason Codes (Examples)

**For "confirmed":**
- `payment_verified`
- `inventory_available`
- `manual_confirmation`

**For "cancelled":**
- `customer_request`
- `out_of_stock`
- `payment_failed`
- `fraud_suspected`

See `ORDER_STATUS_MANAGEMENT.md` for complete list.

## 🎯 Next Steps

1. ✅ Test all status transitions
2. ✅ Verify analytics endpoints work
3. ✅ Check status history tracking
4. ✅ Test customer cancellation
5. ✅ Test admin-only transitions
6. 🔄 Integrate with payment gateway (Phase 2)
7. 🔄 Add order tracking (Phase 2)
8. 🔄 Implement returns/refunds (Phase 3)

## 📞 Support

For detailed documentation, see:
- `ORDER_STATUS_MANAGEMENT.md` - Complete API reference
- `ORDER_STATUS_IMPLEMENTATION_SUMMARY.md` - Implementation details
- `.qoder/quests/advanced-order-management.md` - Design document

For issues or questions, review the test file:
- `test-order-status.js` - Working examples
