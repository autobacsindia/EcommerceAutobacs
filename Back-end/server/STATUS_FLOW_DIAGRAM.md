# Order Status Flow Diagram

## Visual Status Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     ORDER LIFECYCLE                              │
└─────────────────────────────────────────────────────────────────┘

                         ORDER CREATED
                              │
                              ▼
                         ┌──────────┐
                         │ PENDING  │ ◄───────────┐
                         └──────────┘             │
                              │                   │
                     ┌────────┴────────┐         │
                     │                 │         │
                 Customer            Admin       │
                 Cancel?           Confirm?      │
                     │                 │         │
                     ▼                 ▼         │
              ┌───────────┐      ┌───────────┐  │
              │ CANCELLED │      │ CONFIRMED │  │
              └───────────┘      └───────────┘  │
               (TERMINAL)              │        │
                                       │        │
                              ┌────────┴────────┤
                              │                 │
                          Customer           Admin
                          Cancel?          Process?
                              │                 │
                              ▼                 ▼
                       ┌───────────┐     ┌────────────┐
                       │ CANCELLED │     │ PROCESSING │
                       └───────────┘     └────────────┘
                        (TERMINAL)              │
                                                │
                                       ┌────────┴────────┐
                                       │                 │
                                   Admin            Admin Only
                                   Ship?            Cancel?
                                       │                 │
                                       ▼                 ▼
                                 ┌──────────┐     ┌───────────┐
                                 │ SHIPPED  │     │ CANCELLED │
                                 └──────────┘     └───────────┘
                                       │           (TERMINAL)
                                       │
                                   Admin
                                  Deliver?
                                       │
                                       ▼
                                 ┌────────────┐
                                 │ DELIVERED  │
                                 └────────────┘
                                       │
                                       │
                                  Admin Only
                                   Refund?
                                       │
                                       ▼
                                 ┌──────────┐
                                 │ REFUNDED │
                                 └──────────┘
                                  (TERMINAL)
```

## Permission Matrix

```
┌──────────────┬──────────────┬───────────────┬──────────────┐
│   Status     │ Next Status  │   Customer    │    Admin     │
├──────────────┼──────────────┼───────────────┼──────────────┤
│ pending      │ confirmed    │      ❌       │      ✅      │
│ pending      │ cancelled    │      ✅       │      ✅      │
├──────────────┼──────────────┼───────────────┼──────────────┤
│ confirmed    │ processing   │      ❌       │      ✅      │
│ confirmed    │ cancelled    │      ✅       │      ✅      │
├──────────────┼──────────────┼───────────────┼──────────────┤
│ processing   │ shipped      │      ❌       │      ✅      │
│ processing   │ cancelled    │      ❌       │      ✅      │
├──────────────┼──────────────┼───────────────┼──────────────┤
│ shipped      │ delivered    │      ❌       │      ✅      │
├──────────────┼──────────────┼───────────────┼──────────────┤
│ delivered    │ refunded     │      ❌       │      ✅      │
├──────────────┼──────────────┼───────────────┼──────────────┤
│ cancelled    │ (terminal)   │      ❌       │      ❌      │
│ refunded     │ (terminal)   │      ❌       │      ❌      │
└──────────────┴──────────────┴───────────────┴──────────────┘
```

## Status History Timeline

```
┌─────────────────────────────────────────────────────────────────┐
│                    ORDER HISTORY EXAMPLE                         │
└─────────────────────────────────────────────────────────────────┘

Time: 10:00 AM  ┌──────────────────────────────────────┐
                │ PENDING                               │
                │ Created by customer                   │
                │ Order #12345                          │
                └──────────────────────────────────────┘
                              │
Time: 10:05 AM                ▼
                ┌──────────────────────────────────────┐
                │ CONFIRMED                             │
                │ Updated by: Admin (John)              │
                │ Reason: payment_verified              │
                │ Notes: Razorpay payment received      │
                └──────────────────────────────────────┘
                              │
Time: 11:30 AM                ▼
                ┌──────────────────────────────────────┐
                │ PROCESSING                            │
                │ Updated by: Admin (Sarah)             │
                │ Reason: warehouse_assigned            │
                │ Notes: Assigned to Warehouse A        │
                └──────────────────────────────────────┘
                              │
Time: 2:45 PM                 ▼
                ┌──────────────────────────────────────┐
                │ SHIPPED                               │
                │ Updated by: Admin (Mike)              │
                │ Reason: handed_to_carrier             │
                │ Tracking: FEDEX123456789              │
                │ Metrics: Time to ship = 4.5 hours     │
                └──────────────────────────────────────┘
                              │
Time: Next Day                ▼
  10:15 AM      ┌──────────────────────────────────────┐
                │ DELIVERED                             │
                │ Updated by: System                    │
                │ Reason: customer_received             │
                │ Metrics: Time to deliver = 19.5 hours │
                └──────────────────────────────────────┘
```

## Fulfillment Metrics Flow

```
┌─────────────────────────────────────────────────────────────────┐
│              FULFILLMENT METRICS CALCULATION                     │
└─────────────────────────────────────────────────────────────────┘

Order Created (pending)
         │
         ▼
┌─────────────────┐
│  confirmedAt    │ ◄── Timestamp recorded
└─────────────────┘
         │
         ▼
┌─────────────────────┐
│ processingStartedAt │ ◄── Timestamp recorded
└─────────────────────┘
         │
         ▼
┌─────────────────┐
│   shippedAt     │ ◄── Timestamp recorded
└─────────────────┘
         │
         │ timeToShip = shippedAt - confirmedAt
         │ (calculated in hours)
         │
         ▼
┌─────────────────┐
│  deliveredAt    │ ◄── Timestamp recorded
└─────────────────┘
         │
         │ timeToDeliver = deliveredAt - shippedAt
         │ (calculated in hours)
         │
         ▼
   Metrics Complete

Example:
├─ confirmedAt:        Dec 1, 10:05 AM
├─ processingStartedAt: Dec 1, 11:30 AM
├─ shippedAt:          Dec 1, 2:45 PM
├─ deliveredAt:        Dec 2, 10:15 AM
├─ timeToShip:         4.67 hours (2:45 PM - 10:05 AM)
└─ timeToDeliver:      19.5 hours (Dec 2 10:15 AM - Dec 1 2:45 PM)
```

## API Request Flow

```
┌─────────────────────────────────────────────────────────────────┐
│               STATUS UPDATE REQUEST FLOW                         │
└─────────────────────────────────────────────────────────────────┘

Client Request
    │
    ▼
┌──────────────────────────────────────┐
│ PUT /orders/:id/status                │
│ { status, reason, notes, metadata }   │
└──────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────┐
│ Auth Middleware                       │
│ - Verify JWT token                    │
│ - Check user role                     │
└──────────────────────────────────────┘
    │
    ├─── ❌ Unauthorized → 401 Error
    │
    ▼
┌──────────────────────────────────────┐
│ Status Validation Middleware          │
│ - Check order exists                  │
│ - Validate transition                 │
│ - Check permissions                   │
└──────────────────────────────────────┘
    │
    ├─── ❌ Invalid Transition → 400 Error
    │
    ▼
┌──────────────────────────────────────┐
│ Order Status Service                  │
│ - validateTransition()                │
│ - updateOrderStatus()                 │
│ - updateFulfillmentMetrics()          │
│ - addStatusHistory()                  │
└──────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────┐
│ Order Model                           │
│ - Pre-save middleware                 │
│ - Add to statusHistory                │
│ - Update timestamps                   │
│ - Save to MongoDB                     │
└──────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────┐
│ Success Response                      │
│ {                                     │
│   success: true,                      │
│   message: "Status updated",          │
│   order: { ... }                      │
│ }                                     │
└──────────────────────────────────────┘
```

## Service Layer Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                   SERVICE LAYER DIAGRAM                          │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                        Routes Layer                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │ GET      │  │ PUT      │  │ PUT      │  │ GET      │       │
│  │ :id      │  │ :id/     │  │ :id/     │  │ :id/     │       │
│  │          │  │ status   │  │ cancel   │  │ valid-   │       │
│  │          │  │          │  │          │  │ trans    │       │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘       │
└─────────────────────────────────────────────────────────────────┘
        │              │              │              │
        │              │              │              │
┌───────┴──────────────┴──────────────┴──────────────┴───────────┐
│                    Middleware Layer                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │ protect  │  │ validate │  │ validate │  │ validate │       │
│  │          │  │ Transi-  │  │ Cancel-  │  │ Reason   │       │
│  │          │  │ tion     │  │ lation   │  │          │       │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘       │
└─────────────────────────────────────────────────────────────────┘
                             │
                             │
┌────────────────────────────┴────────────────────────────────────┐
│                    Service Layer                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │         orderStatusService                                 │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │  │
│  │  │ validate     │  │ update       │  │ get          │   │  │
│  │  │ Transition   │  │ OrderStatus  │  │ StatusHistory│   │  │
│  │  └──────────────┘  └──────────────┘  └──────────────┘   │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │  │
│  │  │ getValid     │  │ canCustomer  │  │ getStatus    │   │  │
│  │  │ NextStatuses │  │ Cancel       │  │ Statistics   │   │  │
│  │  └──────────────┘  └──────────────┘  └──────────────┘   │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                             │
                             │
┌────────────────────────────┴────────────────────────────────────┐
│                       Model Layer                                │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              Order Model                                   │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │  │
│  │  │ status       │  │ statusHistory│  │ fulfillment  │   │  │
│  │  │              │  │              │  │ Metrics      │   │  │
│  │  └──────────────┘  └──────────────┘  └──────────────┘   │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │  │
│  │  │ getValid     │  │ canTransition│  │ Pre-save     │   │  │
│  │  │ NextStatuses │  │ To           │  │ Middleware   │   │  │
│  │  └──────────────┘  └──────────────┘  └──────────────┘   │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                             │
                             │
┌────────────────────────────┴────────────────────────────────────┐
│                      Database Layer                              │
│                        MongoDB                                   │
│  ┌────────────────────────────────────────────────────────┐     │
│  │  Orders Collection                                      │     │
│  │  - Indexes on status, user, createdAt, trackingNumber  │     │
│  │  - Status history with full audit trail                │     │
│  │  - Fulfillment metrics with timestamps                 │     │
│  └────────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────┘
```

## Error Handling Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    ERROR HANDLING FLOW                           │
└─────────────────────────────────────────────────────────────────┘

Request
   │
   ▼
┌──────────────────────────────┐
│ Try Update Status             │
└──────────────────────────────┘
   │
   ├─── Order Not Found ────────► 404 Error
   │                              "Order not found"
   │
   ├─── Unauthorized ───────────► 403 Error
   │                              "Not authorized"
   │
   ├─── Invalid Transition ─────► 400 Error
   │                              "Cannot transition from X to Y"
   │
   ├─── Admin Required ─────────► 400 Error
   │                              "Admin permission required"
   │
   ├─── Invalid Reason ─────────► 400 Error
   │                              "Invalid reason 'X' for status 'Y'"
   │
   ├─── Terminal State ─────────► 400 Error
   │                              "Cannot transition from terminal state"
   │
   └─── Success ────────────────► 200 Success
                                   { order, history, metrics }
```

## Legend

```
┌─────────────────────────────────────────────────────────────────┐
│                          LEGEND                                  │
└─────────────────────────────────────────────────────────────────┘

✅ = Allowed/Available
❌ = Not Allowed/Not Available
│  = Flow direction
▼  = Next step
►  = Leads to
┌─┐= Component/Section boundary
◄──= Points to/References
```
