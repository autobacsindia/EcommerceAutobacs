# Location Service API Documentation

## Overview

The Location Service API provides Amazon-like delivery location management, multi-warehouse inventory tracking, and zone-based delivery estimation for the Autobacs e-commerce platform.

**Base URL:** `http://localhost:5000`

**Version:** 1.0.0

## Table of Contents

1. [Authentication](#authentication)
2. [Location APIs](#location-apis)
3. [Warehouse APIs](#warehouse-apis)
4. [Delivery Zone APIs](#delivery-zone-apis)
5. [Error Handling](#error-handling)
6. [Setup & Configuration](#setup--configuration)

---

## Authentication

Most location and delivery zone public endpoints do not require authentication. Admin endpoints for warehouse and zone management require JWT authentication with admin role.

### Headers

```http
# For authenticated requests
Authorization: Bearer {jwt_token}

# For guest users (location tracking)
x-session-id: {unique_session_id}
```

---

## Location APIs

### 1. Select Location

Select and save a delivery location for the user or guest session.

**Endpoint:** `POST /location/select`

**Access:** Public

**Request Body:**

```json
{
  "placeId": "ChIJP3Sa8ziYEmsRUKgyFmh9AQM",  // Google Maps Place ID (optional)
  "address": "123 MG Road, Bangalore",        // Manual address (optional)
  "coordinates": {                            // Manual coordinates (optional)
    "latitude": 12.9716,
    "longitude": 77.5946
  },
  "street": "MG Road"                         // Additional street info (optional)
}
```

**Headers:**
- `x-session-id`: Required for guest users

**Response:** `200 OK`

```json
{
  "success": true,
  "location": {
    "_id": "674e1234567890abcdef1234",
    "selectedAddress": {
      "formatted": "123 MG Road, Bangalore, Karnataka 560001, India",
      "street": "MG Road",
      "city": "Bangalore",
      "state": "Karnataka",
      "postalCode": "560001",
      "country": "India",
      "coordinates": {
        "type": "Point",
        "coordinates": [77.5946, 12.9716]
      }
    },
    "deliveryZone": "674e1234567890abcdef5678",
    "nearestWarehouse": "674e1234567890abcdef9012",
    "placeId": "ChIJP3Sa8ziYEmsRUKgyFmh9AQM"
  },
  "deliveryZone": {
    "_id": "674e1234567890abcdef5678",
    "name": "Metro Cities",
    "type": "metro",
    "deliveryTime": {
      "minDays": 2,
      "maxDays": 3
    }
  },
  "nearestWarehouse": {
    "_id": "674e1234567890abcdef9012",
    "name": "Bangalore Tech Hub Warehouse",
    "code": "BLR-01",
    "location": {
      "city": "Bangalore",
      "state": "Karnataka"
    },
    "distance": 5243.67
  },
  "deliveryEstimate": {
    "minDate": "2025-12-05T00:00:00.000Z",
    "maxDate": "2025-12-06T00:00:00.000Z",
    "formattedRange": "between Dec 5 and Dec 6"
  }
}
```

**Error Responses:**

- `400 Bad Request` - Invalid location data or delivery not available for PIN code
- `500 Internal Server Error` - Server error

---

### 2. Get Current Location

Retrieve the user's currently selected location.

**Endpoint:** `GET /location/current`

**Access:** Public

**Headers:**
- `x-session-id`: For guest users
- `Authorization`: For authenticated users

**Response:** `200 OK`

```json
{
  "success": true,
  "location": { /* Location object */ },
  "deliveryZone": { /* DeliveryZone object */ },
  "nearestWarehouse": { /* Warehouse object */ },
  "deliveryEstimate": { /* Delivery estimate */ }
}
```

**Error Responses:**

- `404 Not Found` - No location set
- `500 Internal Server Error` - Server error

---

### 3. Validate Address

Check if an address is serviceable for delivery.

**Endpoint:** `POST /location/validate`

**Access:** Public

**Request Body:**

```json
{
  "postalCode": "560001"
}
```

**Response:** `200 OK`

```json
{
  "success": true,
  "serviceable": true,
  "zone": {
    "_id": "674e1234567890abcdef5678",
    "name": "Metro Cities",
    "type": "metro",
    "deliveryTime": {
      "minDays": 2,
      "maxDays": 3
    }
  },
  "deliveryEstimate": {
    "minDate": "2025-12-05T00:00:00.000Z",
    "maxDate": "2025-12-06T00:00:00.000Z",
    "formattedRange": "between Dec 5 and Dec 6"
  },
  "message": "Delivery available in 2-3 days"
}
```

**Non-serviceable Response:**

```json
{
  "success": true,
  "serviceable": false,
  "message": "Delivery not available for PIN code: 999999"
}
```

---

### 4. Get Recent Locations

Get user's recent delivery locations (authenticated only).

**Endpoint:** `GET /location/recent?limit=5`

**Access:** Private (requires authentication)

**Query Parameters:**
- `limit` (optional): Number of locations to retrieve (default: 5)

**Response:** `200 OK`

```json
{
  "success": true,
  "locations": [
    {
      "_id": "674e1234567890abcdef1234",
      "selectedAddress": { /* Address object */ },
      "deliveryZone": { /* Zone object */ },
      "lastUsed": "2025-12-02T10:30:00.000Z"
    }
  ]
}
```

---

### 5. Clear Location

Clear the saved location for user or session.

**Endpoint:** `DELETE /location/clear`

**Access:** Public

**Response:** `200 OK`

```json
{
  "success": true,
  "message": "Location cleared successfully"
}
```

---

### 6. Get Delivery Estimate

Get delivery estimate for a specific postal code.

**Endpoint:** `GET /location/estimate?postalCode=560001`

**Access:** Public

**Query Parameters:**
- `postalCode` (required): PIN code to check

**Response:** `200 OK`

```json
{
  "success": true,
  "zone": {
    "name": "Metro Cities",
    "type": "metro"
  },
  "estimate": {
    "minDate": "2025-12-05T00:00:00.000Z",
    "maxDate": "2025-12-06T00:00:00.000Z",
    "formattedRange": "between Dec 5 and Dec 6"
  },
  "zoneType": "metro",
  "deliveryDays": "2-3 days"
}
```

---

## Warehouse APIs

### Admin Endpoints

#### 1. List All Warehouses

**Endpoint:** `GET /warehouses?status=active&type=warehouse&city=Mumbai`

**Access:** Private/Admin

**Query Parameters:**
- `status` (optional): Filter by operational status (active, inactive, maintenance)
- `type` (optional): Filter by warehouse type (warehouse, store, hub)
- `city` (optional): Filter by city

**Response:** `200 OK`

```json
{
  "success": true,
  "count": 3,
  "warehouses": [
    {
      "_id": "674e1234567890abcdef9012",
      "name": "Mumbai Central Warehouse",
      "code": "MUM-01",
      "type": "warehouse",
      "location": {
        "address": "Plot No. 45, MIDC Industrial Area, Andheri East",
        "city": "Mumbai",
        "state": "Maharashtra",
        "postalCode": "400093",
        "coordinates": {
          "type": "Point",
          "coordinates": [72.8777, 19.1136]
        }
      },
      "operationalStatus": "active",
      "capacity": 15000,
      "contactInfo": {
        "phone": "+91-22-2345-6789",
        "email": "mumbai@autobacs.in",
        "manager": "Rajesh Kumar"
      },
      "serviceablePinCodes": ["400001", "400002", "..."],
      "isActive": true
    }
  ]
}
```

---

#### 2. Create Warehouse

**Endpoint:** `POST /warehouses`

**Access:** Private/Admin

**Request Body:**

```json
{
  "name": "Chennai Distribution Center",
  "code": "CHN-01",
  "type": "warehouse",
  "location": {
    "address": "Plot 23, Industrial Estate, Guindy",
    "city": "Chennai",
    "state": "Tamil Nadu",
    "postalCode": "600032",
    "coordinates": {
      "type": "Point",
      "coordinates": [80.2206, 13.0067]
    }
  },
  "serviceablePinCodes": ["600001", "600002", "600003"],
  "operationalStatus": "active",
  "operationalHours": {
    "monday": { "open": "09:00", "close": "18:00" },
    "tuesday": { "open": "09:00", "close": "18:00" }
  },
  "contactInfo": {
    "phone": "+91-44-2345-6789",
    "email": "chennai@autobacs.in",
    "manager": "Suresh Kumar"
  },
  "capacity": 10000
}
```

**Response:** `201 Created`

```json
{
  "success": true,
  "warehouse": { /* Created warehouse object */ }
}
```

---

#### 3. Get Warehouse Inventory

**Endpoint:** `GET /warehouses/:id/inventory?page=1&limit=20&lowStock=true`

**Access:** Private/Admin

**Query Parameters:**
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 20)
- `productId` (optional): Filter by product ID
- `lowStock` (optional): Show only low stock items (true/false)

**Response:** `200 OK`

```json
{
  "success": true,
  "inventory": [
    {
      "_id": "674e1234567890abcdef3456",
      "warehouse": "674e1234567890abcdef9012",
      "product": {
        "_id": "674e1234567890abcdef7890",
        "name": "Brake Pads - Front Set",
        "sku": "BP-001"
      },
      "quantity": 45,
      "reservedQuantity": 5,
      "availableQuantity": 40,
      "reorderLevel": 10,
      "reorderQuantity": 50,
      "lastRestocked": "2025-11-25T10:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 245,
    "pages": 13
  }
}
```

---

#### 4. Update Warehouse Stock

**Endpoint:** `PUT /warehouses/:id/inventory/:productId`

**Access:** Private/Admin

**Request Body:**

```json
{
  "quantity": 100,
  "operation": "set"  // Options: set, increment, decrement, reserve, release
}
```

**Response:** `200 OK`

```json
{
  "success": true,
  "inventory": {
    "_id": "674e1234567890abcdef3456",
    "warehouse": "674e1234567890abcdef9012",
    "product": "674e1234567890abcdef7890",
    "quantity": 100,
    "reservedQuantity": 0
  }
}
```

---

### Public Endpoints

#### 1. Check Product Availability

**Endpoint:** `GET /warehouses/products/:productId/availability`

**Access:** Public

**Response:** `200 OK`

```json
{
  "success": true,
  "totalStock": 150,
  "available": 135,
  "reserved": 15,
  "warehouses": [
    {
      "warehouse": {
        "_id": "674e1234567890abcdef9012",
        "name": "Mumbai Central Warehouse",
        "code": "MUM-01"
      },
      "quantity": 75,
      "reservedQuantity": 10,
      "available": 65
    },
    {
      "warehouse": {
        "_id": "674e1234567890abcdef9013",
        "name": "Delhi NCR Distribution Center",
        "code": "DEL-01"
      },
      "quantity": 75,
      "reservedQuantity": 5,
      "available": 70
    }
  ],
  "inStock": true
}
```

---

#### 2. Select Warehouse for Order

**Endpoint:** `POST /warehouses/select-for-order`

**Access:** Public

**Request Body:**

```json
{
  "orderItems": [
    {
      "productId": "674e1234567890abcdef7890",
      "quantity": 2
    },
    {
      "productId": "674e1234567890abcdef7891",
      "quantity": 1
    }
  ],
  "deliveryAddress": {
    "coordinates": {
      "latitude": 19.0760,
      "longitude": 72.8777
    },
    "postalCode": "400001"
  }
}
```

**Response:** `200 OK`

```json
{
  "success": true,
  "available": true,
  "warehouse": {
    "_id": "674e1234567890abcdef9012",
    "name": "Mumbai Central Warehouse",
    "code": "MUM-01",
    "location": {
      "city": "Mumbai",
      "state": "Maharashtra"
    }
  },
  "distance": 5432.12,
  "distanceKm": "5.43",
  "inventory": [
    {
      "_id": "674e1234567890abcdef3456",
      "product": "674e1234567890abcdef7890",
      "quantity": 50,
      "availableQuantity": 45
    }
  ]
}
```

---

## Delivery Zone APIs

### Public Endpoints

#### 1. Get Zone by PIN Code

**Endpoint:** `GET /delivery-zones/pincode/:pinCode`

**Access:** Public

**Example:** `GET /delivery-zones/pincode/400001`

**Response:** `200 OK`

```json
{
  "success": true,
  "zone": {
    "_id": "674e1234567890abcdef5678",
    "name": "Metro Cities",
    "type": "metro",
    "deliveryTime": {
      "minDays": 2,
      "maxDays": 3
    },
    "shippingCost": {
      "baseRate": 50,
      "perKgRate": 10
    },
    "isServiceable": true
  }
}
```

---

#### 2. Check Serviceability

**Endpoint:** `POST /delivery-zones/check-serviceability`

**Access:** Public

**Request Body:**

```json
{
  "pinCode": "560001"
}
```

**Response:** `200 OK`

```json
{
  "success": true,
  "serviceable": true,
  "zone": { /* Zone object */ },
  "message": "Delivery available in 2-3 business days"
}
```

---

#### 3. Get Delivery Estimate

**Endpoint:** `POST /delivery-zones/estimate`

**Access:** Public

**Request Body:**

```json
{
  "pinCode": "560001",
  "orderDate": "2025-12-02T10:00:00.000Z"  // Optional, defaults to current date
}
```

**Response:** `200 OK`

```json
{
  "success": true,
  "zone": {
    "name": "Metro Cities",
    "type": "metro"
  },
  "estimate": {
    "minDate": "2025-12-05T00:00:00.000Z",
    "maxDate": "2025-12-06T00:00:00.000Z",
    "formattedRange": "between Dec 5 and Dec 6"
  },
  "deliveryDays": "2-3 days"
}
```

---

#### 4. Calculate Shipping Cost

**Endpoint:** `POST /delivery-zones/shipping-cost`

**Access:** Public

**Request Body:**

```json
{
  "pinCode": "560001",
  "weightKg": 2.5
}
```

**Response:** `200 OK`

```json
{
  "success": true,
  "zone": "Metro Cities",
  "weightKg": 2.5,
  "shippingCost": 75,
  "breakdown": {
    "baseRate": 50,
    "perKgRate": 10,
    "weightCharge": 25
  }
}
```

---

### Admin Endpoints

#### 1. List All Zones

**Endpoint:** `GET /delivery-zones?type=metro&serviceable=true`

**Access:** Private/Admin

**Response:** Similar to warehouse list endpoint

---

#### 2. Create Delivery Zone

**Endpoint:** `POST /delivery-zones`

**Access:** Private/Admin

**Request Body:**

```json
{
  "name": "North East Region",
  "type": "tier2",
  "deliveryTime": {
    "minDays": 5,
    "maxDays": 7
  },
  "shippingCost": {
    "baseRate": 120,
    "perKgRate": 18
  },
  "pinCodes": ["781001", "781002", "781003"],
  "cities": ["Guwahati", "Dibrugarh"],
  "states": ["Assam"],
  "isServiceable": true,
  "priority": 5
}
```

---

#### 3. Add PIN Codes to Zone

**Endpoint:** `POST /delivery-zones/:id/pincodes`

**Access:** Private/Admin

**Request Body:**

```json
{
  "pinCodes": ["560200", "560201", "560202"]
}
```

---

#### 4. Bulk Import PIN Codes

**Endpoint:** `POST /delivery-zones/bulk-import`

**Access:** Private/Admin

**Request Body:**

```json
{
  "pinCodeData": [
    {
      "pinCode": "110001",
      "zoneType": "metro",
      "city": "Delhi",
      "state": "Delhi"
    },
    {
      "pinCode": "110002",
      "zoneType": "metro",
      "city": "Delhi",
      "state": "Delhi"
    }
  ]
}
```

**Response:** `200 OK`

```json
{
  "success": true,
  "results": [
    {
      "zoneType": "metro",
      "pinCodesAdded": 2,
      "zone": "674e1234567890abcdef5678"
    }
  ],
  "totalPinCodes": 2
}
```

---

## Error Handling

### Error Response Format

```json
{
  "success": false,
  "message": "Error description"
}
```

### Common Error Codes

- `400 Bad Request` - Invalid input data
- `401 Unauthorized` - Missing or invalid authentication
- `403 Forbidden` - Insufficient permissions
- `404 Not Found` - Resource not found
- `429 Too Many Requests` - Rate limit exceeded
- `500 Internal Server Error` - Server error

---

## Setup & Configuration

### Environment Variables

```env
# Google Maps API Configuration
GOOGLE_MAPS_CLIENT_KEY=your_client_key_here
GOOGLE_MAPS_SERVER_KEY=your_server_key_here
GOOGLE_MAPS_REGION=IN
GOOGLE_MAPS_LANGUAGE=en

# Location Service Configuration
SESSION_LOCATION_EXPIRY=7
GEOCODING_CACHE_DURATION=30
MAX_ADDRESS_SEARCH_RESULTS=5
DEFAULT_LOCATION_RADIUS=50000

# Delivery Settings
WAREHOUSE_PROCESSING_DAYS=1
EXCLUDE_SUNDAYS=true
DELIVERY_ESTIMATE_BUFFER=0

# Inventory Settings
STOCK_RESERVATION_TIMEOUT=24
LOW_STOCK_THRESHOLD=5
ENABLE_SPLIT_SHIPMENTS=false
STOCK_SYNC_FREQUENCY=3600
```

### Initial Setup Commands

```bash
# 1. Install dependencies
npm install

# 2. Seed delivery zones
node seed-delivery-zones.js

# 3. Seed sample warehouses
node seed-sample-warehouses.js

# 4. Migrate existing product stock to warehouse inventory
node migrate-warehouse-inventory.js

# 5. Start server
npm run dev
```

---

## Rate Limits

- General API endpoints: 100 requests per 15 minutes per IP
- Admin endpoints: 50 requests per 15 minutes per user

---

## Support

For API support or questions:
- Email: api-support@autobacs.in
- Documentation: http://localhost:5000/

---

**Last Updated:** December 2, 2025  
**API Version:** 1.0.0
