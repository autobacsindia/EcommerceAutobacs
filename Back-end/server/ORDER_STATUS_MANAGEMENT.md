# Order Status Management System

## Overview
Advanced order status transition system with validation, history tracking, and fulfillment metrics.

## Status Transition Rules

### Valid Status Flow
```
pending → confirmed → processing → shipped → delivered
   ↓                ↓          ↓
cancelled      cancelled  cancelled
                          (admin only)

delivered → refunded (admin only)
```

### Status Definitions

| Status | Description | Who Can Set |
|--------|-------------|-------------|
| `pending` | Order created, awaiting confirmation | System |
| `confirmed` | Payment verified, order confirmed | Admin/System |
| `processing` | Order being prepared for shipping | Admin |
| `shipped` | Order handed to carrier | Admin |
| `delivered` | Order received by customer | Admin/System |
| `cancelled` | Order cancelled | Customer (limited) / Admin |
| `refunded` | Payment refunded to customer | Admin |

### Transition Restrictions

#### Customer Permissions
- Can cancel orders in `pending` or `confirmed` status
- Cannot cancel after `processing` starts
- Cannot modify status directly

#### Admin Permissions
- Full control over all status transitions
- Can cancel orders in `processing` (special approval)
- Cannot cancel `shipped` orders
- Can initiate refunds for `delivered` orders

## API Endpoints

### 1. Update Order Status (Admin)
```http
PUT /orders/:id/status
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "status": "confirmed",
  "reason": "payment_verified",
  "notes": "Payment confirmed via gateway",
  "trackingNumber": "TRACK123456",
  "estimatedDelivery": "2024-12-10T10:00:00Z",
  "metadata": {
    "gatewayId": "pay_xyz123"
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Order status updated to 'confirmed'",
  "order": {
    "_id": "order_id",
    "status": "confirmed",
    "statusHistory": [...],
    "fulfillmentMetrics": {...}
  }
}
```

### 2. Get Status History
```http
GET /orders/:id/status-history
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "currentStatus": "processing",
  "history": [
    {
      "status": "pending",
      "timestamp": "2024-12-01T10:00:00Z",
      "updatedBy": null,
      "reason": null
    },
    {
      "status": "confirmed",
      "timestamp": "2024-12-01T10:05:00Z",
      "updatedBy": {
        "_id": "admin_id",
        "name": "Admin User",
        "email": "admin@example.com",
        "role": "admin"
      },
      "reason": "payment_verified",
      "notes": "Payment confirmed"
    }
  ]
}
```

### 3. Get Valid Next Statuses
```http
GET /orders/:id/valid-transitions
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "currentStatus": "confirmed",
  "validNextStatuses": ["processing", "cancelled"],
  "validReasons": {
    "processing": ["warehouse_assigned", "items_picked", "packing_started"],
    "cancelled": ["customer_request", "out_of_stock", "payment_failed"]
  }
}
```

### 4. Cancel Order (Customer/Admin)
```http
PUT /orders/:id/cancel
Authorization: Bearer <token>
Content-Type: application/json

{
  "reason": "customer_request",
  "notes": "Changed my mind"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Order cancelled successfully",
  "order": {...}
}
```

### 5. Get Status Statistics (Admin)
```http
GET /orders/analytics/status-stats?startDate=2024-12-01&endDate=2024-12-31
Authorization: Bearer <admin_token>
```

**Response:**
```json
{
  "success": true,
  "statistics": [
    {
      "status": "delivered",
      "count": 150,
      "totalValue": 450000
    },
    {
      "status": "processing",
      "count": 25,
      "totalValue": 75000
    }
  ]
}
```

### 6. Get Fulfillment Metrics (Admin)
```http
GET /orders/analytics/fulfillment-metrics?startDate=2024-12-01&endDate=2024-12-31
Authorization: Bearer <admin_token>
```

**Response:**
```json
{
  "success": true,
  "metrics": {
    "avgTimeToShip": 24.5,
    "avgTimeToDeliver": 72.3,
    "minTimeToShip": 12,
    "maxTimeToShip": 48,
    "minTimeToDeliver": 48,
    "maxTimeToDeliver": 120,
    "totalOrders": 150
  }
}
```

## Valid Transition Reasons

### confirmed
- `payment_verified` - Payment successfully processed
- `inventory_available` - All items in stock
- `manual_confirmation` - Manually confirmed by admin

### processing
- `warehouse_assigned` - Order assigned to warehouse
- `items_picked` - Items picked from inventory
- `packing_started` - Packing process initiated

### shipped
- `handed_to_carrier` - Package given to shipping carrier
- `label_created` - Shipping label generated
- `in_transit` - Package in transit

### delivered
- `customer_received` - Customer confirmed receipt
- `left_at_door` - Left at customer's address
- `signed_for` - Signature received

### cancelled
- `customer_request` - Customer requested cancellation
- `out_of_stock` - Items not available
- `payment_failed` - Payment could not be processed
- `fraud_suspected` - Potential fraudulent order
- `duplicate_order` - Duplicate order detected

### refunded
- `return_completed` - Customer return processed
- `damaged_item` - Item was damaged
- `quality_issue` - Quality problems reported
- `order_cancelled` - Order was cancelled

## Data Models

### Status History Entry
```javascript
{
  status: String,              // Status value
  timestamp: Date,             // When status was set
  updatedBy: ObjectId,         // User who updated (can be null for system)
  reason: String,              // Reason code
  notes: String,               // Additional notes
  metadata: Mixed              // Additional metadata
}
```

### Fulfillment Metrics
```javascript
{
  confirmedAt: Date,           // When order was confirmed
  processingStartedAt: Date,   // When processing started
  shippedAt: Date,             // When order was shipped
  deliveredAt: Date,           // When order was delivered
  timeToShip: Number,          // Hours from confirmation to shipping
  timeToDeliver: Number        // Hours from shipping to delivery
}
```

## Usage Examples

### Example 1: Complete Order Workflow (Admin)

```javascript
// 1. Confirm order
await fetch('/orders/order_id/status', {
  method: 'PUT',
  headers: {
    'Authorization': 'Bearer admin_token',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    status: 'confirmed',
    reason: 'payment_verified',
    notes: 'Payment received via Razorpay'
  })
});

// 2. Start processing
await fetch('/orders/order_id/status', {
  method: 'PUT',
  headers: {
    'Authorization': 'Bearer admin_token',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    status: 'processing',
    reason: 'warehouse_assigned',
    notes: 'Assigned to warehouse #1'
  })
});

// 3. Mark as shipped
await fetch('/orders/order_id/status', {
  method: 'PUT',
  headers: {
    'Authorization': 'Bearer admin_token',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    status: 'shipped',
    reason: 'handed_to_carrier',
    trackingNumber: 'FEDEX123456789',
    estimatedDelivery: '2024-12-15T10:00:00Z',
    notes: 'Handed to FedEx'
  })
});

// 4. Mark as delivered
await fetch('/orders/order_id/status', {
  method: 'PUT',
  headers: {
    'Authorization': 'Bearer admin_token',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    status: 'delivered',
    reason: 'customer_received',
    notes: 'Package delivered successfully'
  })
});
```

### Example 2: Customer Cancellation

```javascript
await fetch('/orders/order_id/cancel', {
  method: 'PUT',
  headers: {
    'Authorization': 'Bearer customer_token',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    reason: 'customer_request',
    notes: 'Found a better deal elsewhere'
  })
});
```

### Example 3: Check Valid Transitions

```javascript
const response = await fetch('/orders/order_id/valid-transitions', {
  headers: {
    'Authorization': 'Bearer token'
  }
});

const data = await response.json();
// data.validNextStatuses contains allowed transitions
// data.validReasons contains valid reasons for each transition
```

## Error Handling

### Common Errors

#### Invalid Transition
```json
{
  "success": false,
  "message": "Cannot transition from 'shipped' to 'pending'. Allowed transitions: delivered"
}
```

#### Permission Denied
```json
{
  "success": false,
  "message": "Admin permission required to transition from 'processing' to 'cancelled'"
}
```

#### Invalid Reason
```json
{
  "success": false,
  "message": "Invalid reason 'invalid_reason' for status 'confirmed'. Valid reasons: payment_verified, inventory_available, manual_confirmation"
}
```

#### Order Not Found
```json
{
  "success": false,
  "message": "Order not found"
}
```

## Testing

Run the test suite:
```bash
node test-order-status.js
```

The test suite validates:
1. ✓ Status transition validation rules
2. ✓ Valid next statuses for each state
3. ✓ Order status updates
4. ✓ Status history tracking
5. ✓ Fulfillment metrics calculation
6. ✓ Status statistics aggregation

## Best Practices

### 1. Always Provide Reasons
```javascript
// Good
await updateOrderStatus(orderId, 'cancelled', {
  reason: 'out_of_stock',
  notes: 'Product discontinued by manufacturer'
});

// Avoid
await updateOrderStatus(orderId, 'cancelled', {});
```

### 2. Check Valid Transitions Before Updating
```javascript
// Check what transitions are allowed
const { validNextStatuses } = await getValidTransitions(orderId);

// Only show valid options to user
if (validNextStatuses.includes('shipped')) {
  // Allow user to mark as shipped
}
```

### 3. Track Who Made Changes
```javascript
// Always include userId
await updateOrderStatus(orderId, 'confirmed', {
  userId: req.user.id,
  isAdmin: req.user.role === 'admin',
  reason: 'payment_verified'
});
```

### 4. Monitor Fulfillment Metrics
```javascript
// Regularly check fulfillment performance
const metrics = await orderStatusService.getFulfillmentMetrics({
  createdAt: { $gte: startOfMonth, $lte: endOfMonth }
});

// Alert if metrics exceed thresholds
if (metrics.avgTimeToShip > 48) {
  // Send alert to operations team
}
```

## Integration Points

### 1. Payment Gateway Integration
When payment is confirmed, update order status:
```javascript
paymentWebhook.on('payment.success', async (payment) => {
  await orderStatusService.updateOrderStatus(payment.orderId, 'confirmed', {
    userId: null, // System update
    isAdmin: true,
    reason: 'payment_verified',
    metadata: {
      gatewayId: payment.gatewayId,
      transactionId: payment.transactionId
    }
  });
});
```

### 2. Warehouse Management System
When order is ready to ship:
```javascript
warehouseSystem.on('order.ready', async (order) => {
  await orderStatusService.updateOrderStatus(order.id, 'shipped', {
    userId: warehouseAdminId,
    isAdmin: true,
    reason: 'handed_to_carrier',
    metadata: {
      warehouseId: order.warehouseId,
      carrier: order.carrier,
      weight: order.packageWeight
    }
  });
});
```

### 3. Notification System
Send notifications on status changes:
```javascript
// In your status update handler
const result = await orderStatusService.updateOrderStatus(orderId, newStatus, options);

if (result.success) {
  // Send email/SMS notification
  await notificationService.sendOrderStatusUpdate(
    result.order.user,
    result.order,
    newStatus
  );
}
```

## Performance Considerations

### Indexing
The Order model includes indexes on:
- `status` - For filtering by status
- `statusHistory.status` - For querying status history
- `user` + `createdAt` - For user order queries

### Caching
Consider caching:
- Valid transition rules (static data)
- Status statistics (with short TTL)
- Fulfillment metrics (5-15 minute cache)

### Pagination
Always paginate order lists:
```javascript
const orders = await Order.find({ status: 'processing' })
  .limit(20)
  .skip((page - 1) * 20)
  .sort({ createdAt: -1 });
```

## Security

### Authorization Checks
- All status updates verify user permissions
- Customers can only cancel their own orders
- Admin-only transitions are enforced
- Status history tracks who made changes

### Audit Trail
Every status change is logged with:
- Timestamp
- User who made the change
- Reason for change
- Additional notes and metadata

### Validation
- Status transitions are validated before saving
- Invalid transitions are rejected with clear error messages
- Reasons are validated against allowed values
