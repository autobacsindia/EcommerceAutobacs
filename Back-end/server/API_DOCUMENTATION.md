# Autobacs India API Documentation

**Base URL:** `http://localhost:5000`

**Version:** 1.0.0

## Table of Contents
- [Authentication](#authentication)
- [Products](#products)
- [Categories](#categories)
- [Vehicles](#vehicles)
- [Cart](#cart)
- [Wishlist](#wishlist)
- [Orders](#orders)

---

## Authentication

### Register User
**POST** `/auth/register`

**Access:** Public

**Body:**
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "password123"
}
```

**Response:** 201
```json
{
  "success": true,
  "message": "User registered successfully",
  "token": "eyJhbGc...",
  "user": {
    "id": "...",
    "name": "John Doe",
    "email": "john@example.com",
    "role": "customer"
  }
}
```

### Login
**POST** `/auth/login`

**Access:** Public

**Body:**
```json
{
  "email": "john@example.com",
  "password": "password123"
}
```

**Response:** 200
```json
{
  "success": true,
  "message": "Login successful",
  "token": "eyJhbGc...",
  "user": {
    "id": "...",
    "name": "John Doe",
    "email": "john@example.com",
    "role": "customer"
  }
}
```

### Get Current User Profile
**GET** `/auth/me`

**Access:** Private

**Headers:**
```
Authorization: Bearer {token}
```

**Response:** 200
```json
{
  "success": true,
  "user": {
    "id": "...",
    "name": "John Doe",
    "email": "john@example.com",
    "role": "customer"
  }
}
```

---

## Products

### Get All Products
**GET** `/products?page=1&limit=12&category=...&brand=...&minPrice=...&maxPrice=...&search=...&vehicle=...&isFeatured=...&sortBy=price&order=asc`

**Access:** Public

**Query Parameters:**
- `page` (default: 1)
- `limit` (default: 12)
- `category` - Category ID
- `brand` - Brand name
- `minPrice` - Minimum price
- `maxPrice` - Maximum price
- `search` - Text search
- `vehicle` - Vehicle ID
- `isFeatured` - true/false
- `sortBy` - Field to sort by (default: createdAt)
- `order` - asc/desc (default: desc)

**Response:** 200
```json
{
  "success": true,
  "count": 12,
  "total": 100,
  "pages": 9,
  "currentPage": 1,
  "products": [...]
}
```

### Get Featured Products
**GET** `/products/featured?limit=6`

**Access:** Public

### Get Product by ID
**GET** `/products/:id`

**Access:** Public

### Create Product (Admin)
**POST** `/products`

**Access:** Private/Admin

**Headers:**
```
Authorization: Bearer {token}
```

**Body:**
```json
{
  "name": "Product Name",
  "description": "Product description",
  "price": 999,
  "category": "categoryId",
  "stock": 100,
  "brand": "Brand Name",
  "images": [
    {
      "url": "https://...",
      "alt": "Product image",
      "isPrimary": true
    }
  ],
  "compatibleVehicles": ["vehicleId1", "vehicleId2"]
}
```

### Update Product (Admin)
**PUT** `/products/:id`

**Access:** Private/Admin

### Delete Product (Admin)
**DELETE** `/products/:id`

**Access:** Private/Admin

### Update Stock (Admin)
**POST** `/products/:id/stock`

**Access:** Private/Admin

**Body:**
```json
{
  "stock": 50
}
```

---

## Categories

### Get All Categories
**GET** `/categories`

**Access:** Public

**Response:** 200
```json
{
  "success": true,
  "count": 10,
  "categories": [...]
}
```

### Get Category by ID
**GET** `/categories/:id`

**Access:** Public

### Get Category by Slug
**GET** `/categories/slug/:slug`

**Access:** Public

### Create Category (Admin)
**POST** `/categories`

**Access:** Private/Admin

**Body:**
```json
{
  "name": "Category Name",
  "slug": "category-name",
  "description": "Category description",
  "parent": "parentCategoryId",
  "order": 1
}
```

### Update Category (Admin)
**PUT** `/categories/:id`

**Access:** Private/Admin

### Delete Category (Admin)
**DELETE** `/categories/:id`

**Access:** Private/Admin

---

## Vehicles

### Get All Vehicles
**GET** `/vehicles?make=Toyota&model=Hilux&year=2023`

**Access:** Public

### Get All Makes
**GET** `/vehicles/makes`

**Access:** Public

**Response:** 200
```json
{
  "success": true,
  "count": 15,
  "makes": ["Toyota", "Mahindra", "Isuzu", ...]
}
```

### Get Models by Make
**GET** `/vehicles/models/:make`

**Access:** Public

### Get Vehicle by ID
**GET** `/vehicles/:id`

**Access:** Public

### Get Vehicle by Slug
**GET** `/vehicles/slug/:slug`

**Access:** Public

### Create Vehicle (Admin)
**POST** `/vehicles`

**Access:** Private/Admin

**Body:**
```json
{
  "make": "Toyota",
  "model": "Hilux",
  "year": 2023,
  "variant": "GR Sport",
  "slug": "toyota-hilux-2023-gr-sport"
}
```

### Update Vehicle (Admin)
**PUT** `/vehicles/:id`

**Access:** Private/Admin

### Delete Vehicle (Admin)
**DELETE** `/vehicles/:id`

**Access:** Private/Admin

---

## Cart

### Get User's Cart
**GET** `/cart`

**Access:** Private

**Headers:**
```
Authorization: Bearer {token}
```

**Response:** 200
```json
{
  "success": true,
  "cart": {
    "user": "userId",
    "items": [
      {
        "product": {...},
        "quantity": 2,
        "price": 999
      }
    ],
    "totalItems": 2,
    "totalPrice": 1998
  }
}
```

### Add Item to Cart
**POST** `/cart/add`

**Access:** Private

**Body:**
```json
{
  "productId": "productId",
  "quantity": 1
}
```

### Update Cart Item
**PUT** `/cart/update/:productId`

**Access:** Private

**Body:**
```json
{
  "quantity": 3
}
```

### Remove Item from Cart
**DELETE** `/cart/remove/:productId`

**Access:** Private

### Clear Cart
**DELETE** `/cart/clear`

**Access:** Private

---

## Wishlist

### Get User's Wishlist
**GET** `/wishlist`

**Access:** Private

### Add Item to Wishlist
**POST** `/wishlist/add`

**Access:** Private

**Body:**
```json
{
  "productId": "productId"
}
```

### Remove Item from Wishlist
**DELETE** `/wishlist/remove/:productId`

**Access:** Private

### Clear Wishlist
**DELETE** `/wishlist/clear`

**Access:** Private

---

## Orders

### Get User's Orders
**GET** `/orders`

**Access:** Private

**Response:** 200
```json
{
  "success": true,
  "count": 5,
  "orders": [...]
}
```

### Get Order by ID
**GET** `/orders/:id`

**Access:** Private

### Create Order
**POST** `/orders`

**Access:** Private

**Body:**
```json
{
  "items": [
    {
      "product": "productId",
      "quantity": 2
    }
  ],
  "shippingAddress": {
    "fullName": "John Doe",
    "phone": "+91 9876543210",
    "addressLine1": "123 Main Street",
    "city": "Mumbai",
    "state": "Maharashtra",
    "postalCode": "400001",
    "country": "India"
  },
  "shippingCost": 100,
  "tax": 50,
  "discount": 0
}
```

**Response:** 201
```json
{
  "success": true,
  "message": "Order created successfully",
  "order": {...}
}
```

### Cancel Order
**PUT** `/orders/:id/cancel`

**Access:** Private

**Body:**
```json
{
  "reason": "Changed my mind"
}
```

### Update Order Status (Admin)
**PUT** `/orders/:id/status`

**Access:** Private/Admin

**Body:**
```json
{
  "status": "shipped",
  "trackingNumber": "TRACK123456",
  "estimatedDelivery": "2025-11-25"
}
```

### Get All Orders (Admin)
**GET** `/orders/admin/all?status=pending&page=1&limit=20`

**Access:** Private/Admin

---

## Error Responses

### 400 Bad Request
```json
{
  "success": false,
  "message": "Error message",
  "errors": ["Error detail 1", "Error detail 2"]
}
```

### 401 Unauthorized
```json
{
  "success": false,
  "message": "Not authorized, no token provided"
}
```

### 403 Forbidden
```json
{
  "success": false,
  "message": "Not authorized as admin"
}
```

### 404 Not Found
```json
{
  "success": false,
  "message": "Resource not found"
}
```

### 429 Too Many Requests
```json
{
  "success": false,
  "message": "Too many requests, please try again later"
}
```

### 500 Internal Server Error
```json
{
  "success": false,
  "message": "Internal Server Error"
}
```

---

## Rate Limiting

- **Authentication routes** (`/auth/*`): 5 requests per 15 minutes
- **All other routes**: 100 requests per 15 minutes

---

## Authentication

Protected routes require a JWT token in the Authorization header:

```
Authorization: Bearer {your_jwt_token}
```

Tokens are returned upon successful registration or login and expire after 7 days.

---

## Pagination

Paginated endpoints return:
- `count`: Number of items in current response
- `total`: Total number of items
- `pages`: Total number of pages
- `currentPage`: Current page number

---

## Admin Access

Admin-only endpoints require:
1. Valid JWT token
2. User role must be "admin"

To create an admin user, manually update the user's role in the database:
```javascript
db.users.updateOne(
  { email: "admin@example.com" },
  { $set: { role: "admin" } }
)
```
