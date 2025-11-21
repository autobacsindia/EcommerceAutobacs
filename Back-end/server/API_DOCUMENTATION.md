# Autobacs API Documentation

## Overview
This document provides documentation for all API endpoints available in the Autobacs e-commerce platform backend.

## Authentication
Most endpoints require authentication. Tokens are obtained through the authentication endpoints and should be included in the Authorization header as Bearer tokens.

## API Endpoints

### Authentication
**POST** `/auth/register`
**POST** `/auth/login`
**GET** `/auth/profile`
**PUT** `/auth/profile`
**POST** `/auth/logout`

### Products
**GET** `/products`
**GET** `/products/:id`
**POST** `/products`
**PUT** `/products/:id`
**DELETE** `/products/:id`
**GET** `/products/featured`
**GET** `/products/suggestions`
**PUT** `/products/:id/stock`
**POST** `/products/import/wordpress`
**GET** `/products/import/status/:jobId`
**POST** `/products/import/schedule`
**GET** `/products/import/schedule`

### Categories
**GET** `/categories`
**GET** `/categories/:id`
**POST** `/categories`
**PUT** `/categories/:id`
**DELETE** `/categories/:id`

### Vehicles
**GET** `/vehicles`
**GET** `/vehicles/:id`
**POST** `/vehicles`
**PUT** `/vehicles/:id`
**DELETE** `/vehicles/:id`
**GET** `/vehicles/search/:query`

### Cart
**GET** `/cart`
**POST** `/cart`
**PUT** `/cart/:id`
**DELETE** `/cart/:id`

### Wishlist
**GET** `/wishlist`
**POST** `/wishlist`
**DELETE** `/wishlist/:id`

### Orders
**GET** `/orders`
**GET** `/orders/:id`
**POST** `/orders`
**PUT** `/orders/:id`

### Scheduled Tasks (Admin Only)
**GET** `/scheduled-tasks`
**POST** `/scheduled-tasks/cancel/:taskName`
**POST** `/scheduled-tasks/run/:taskName`

## Detailed Endpoint Documentation

### Authentication Endpoints

**POST** `/auth/register`
**Access:** Public
**Description:** Register a new user account

**Body:**
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "password123",
  "phone": "1234567890"
}
```

**Response:** 201
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "_id": "507f1f77bcf86cd799439011",
    "name": "John Doe",
    "email": "john@example.com",
    "phone": "1234567890",
    "isAdmin": false
  }
}
```

**POST** `/auth/login`
**Access:** Public
**Description:** Login to existing account

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
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "_id": "507f1f77bcf86cd799439011",
    "name": "John Doe",
    "email": "john@example.com",
    "phone": "1234567890",
    "isAdmin": false
  }
}
```

**GET** `/auth/profile`
**Access:** Private
**Description:** Get current user profile

**Response:** 200
```json
{
  "success": true,
  "user": {
    "_id": "507f1f77bcf86cd799439011",
    "name": "John Doe",
    "email": "john@example.com",
    "phone": "1234567890",
    "isAdmin": false,
    "createdAt": "2025-11-20T10:00:00.000Z"
  }
}
```

**PUT** `/auth/profile`
**Access:** Private
**Description:** Update current user profile

**Body:**
```json
{
  "name": "John Smith",
  "email": "johnsmith@example.com",
  "phone": "0987654321"
}
```

**Response:** 200
```json
{
  "success": true,
  "user": {
    "_id": "507f1f77bcf86cd799439011",
    "name": "John Smith",
    "email": "johnsmith@example.com",
    "phone": "0987654321",
    "isAdmin": false
  }
}
```

### Product Endpoints

**GET** `/products`
**Access:** Public
**Description:** Get all products with filtering, sorting, and pagination

**Query Parameters:**
- `keyword` - Search keyword
- `category` - Filter by category ID
- `vehicle` - Filter by vehicle compatibility
- `minPrice` - Minimum price filter
- `maxPrice` - Maximum price filter
- `sort` - Sort by field (price, name, createdAt)
- `order` - Sort order (asc, desc)
- `page` - Page number (default: 1)
- `limit` - Items per page (default: 12)

**Response:** 200
```json
{
  "success": true,
  "count": 12,
  "products": [...],
  "page": 1,
  "pages": 3
}
```

**GET** `/products/:id`
**Access:** Public
**Description:** Get specific product by ID

**Response:** 200
```json
{
  "success": true,
  "product": {
    "_id": "507f1f77bcf86cd799439011",
    "name": "Product Name",
    "description": "Product description",
    "price": 99.99,
    "category": {
      "_id": "507f191e810c19729de860ea",
      "name": "Category Name"
    },
    "images": [...],
    "specifications": [...],
    "compatibility": [...]
  }
}
```

**POST** `/products`
**Access:** Private/Admin
**Description:** Create a new product

**Body:**
```json
{
  "name": "New Product",
  "description": "Product description",
  "price": 99.99,
  "category": "507f191e810c19729de860ea",
  "images": [...],
  "specifications": [...],
  "compatibility": [...]
}
```

**Response:** 201
```json
{
  "success": true,
  "product": {
    "_id": "507f1f77bcf86cd799439011",
    "name": "New Product",
    "description": "Product description",
    "price": 99.99,
    "category": "507f191e810c19729de860ea",
    "images": [...],
    "specifications": [...],
    "compatibility": [...]
  }
}
```

**PUT** `/products/:id`
**Access:** Private/Admin
**Description:** Update existing product

**Body:**
```json
{
  "name": "Updated Product",
  "price": 149.99
}
```

**Response:** 200
```json
{
  "success": true,
  "product": {
    "_id": "507f1f77bcf86cd799439011",
    "name": "Updated Product",
    "price": 149.99,
    // ... other fields
  }
}
```

**DELETE** `/products/:id`
**Access:** Private/Admin
**Description:** Delete product

**Response:** 200
```json
{
  "success": true,
  "message": "Product removed"
}
```

**GET** `/products/featured`
**Access:** Public
**Description:** Get featured products

**Query Parameters:**
- `limit` - Number of products to return (default: 6)

**Response:** 200
```json
{
  "success": true,
  "products": [...]
}
```

**GET** `/products/suggestions`
**Access:** Public
**Description:** Get search suggestions

**Query Parameters:**
- `q` - Search query
- `limit` - Number of suggestions to return (default: 10)

**Response:** 200
```json
{
  "success": true,
  "suggestions": ["Product 1", "Product 2", ...]
}
```

**PUT** `/products/:id/stock`
**Access:** Private/Admin
**Description:** Update product stock

**Body:**
```json
{
  "stock": 50
}
```

**Response:** 200
```json
{
  "success": true,
  "message": "Stock updated successfully",
  "product": {
    "_id": "507f1f77bcf86cd799439011",
    "name": "Product Name",
    "stock": 50
  }
}
```

### Product Import Endpoints

**POST** `/products/import/wordpress`
**Access:** Private/Admin
**Description:** Import products from WordPress

**Response:** 200
```json
{
  "success": true,
  "message": "Products imported successfully",
  "jobId": "import-1234567890-abc123",
  "summary": {
    "totalProducts": 150,
    "imported": 145,
    "failed": 5,
    "skipped": 0
  }
}
```

**GET** `/products/import/status/:jobId`
**Access:** Private/Admin
**Description:** Get specific import job status

**Response:** 200
```json
{
  "success": true,
  "job": {
    "jobId": "import-1234567890-abc123",
    "status": "completed",
    "totalProducts": 150,
    "processedProducts": 150,
    "importedProducts": 145,
    "failedProducts": 5,
    "skippedProducts": 0,
    "progress": 100,
    "startedAt": "2025-11-20T10:00:00.000Z",
    "completedAt": "2025-11-20T10:05:00.000Z",
    "initiatedBy": "userId"
  }
}
```

**POST** `/products/import/schedule`
**Access:** Private/Admin
**Description:** Schedule recurring imports

**Body:**
```json
{
  "frequency": "daily",
  "time": "02:00"
}
```

**Response:** 200
```json
{
  "success": true,
  "message": "Import scheduled successfully",
  "schedule": {
    "id": "schedule-1234567890-abc123",
    "frequency": "daily",
    "time": "02:00",
    "initiatedBy": "userId",
    "createdAt": "2025-11-20T10:00:00.000Z",
    "enabled": true
  }
}
```

**GET** `/products/import/schedule`
**Access:** Private/Admin
**Description:** Get all scheduled imports

**Response:** 200
```json
{
  "success": true,
  "schedules": [...]
}
```

### Scheduled Tasks Endpoints

**GET** `/scheduled-tasks`
**Access:** Private/Admin
**Description:** Get all scheduled tasks

**Response:** 200
```json
{
  "success": true,
  "tasks": [
    {
      "name": "failedProductImport",
      "schedule": "10 11 * * *",
      "description": "Daily import of failed products at 11:10 AM"
    }
  ]
}
```

**POST** `/scheduled-tasks/cancel/:taskName`
**Access:** Private/Admin
**Description:** Cancel a scheduled task

**Response:** 200
```json
{
  "success": true,
  "message": "Task cancelled successfully"
}
```

**POST** `/scheduled-tasks/run/:taskName`
**Access:** Private/Admin
**Description:** Manually run a scheduled task

**Response:** 200
```json
{
  "success": true,
  "message": "Failed product import task executed successfully",
  "result": {
    "success": true,
    "jobId": "failed-import-1763704254743-6stztkqvl",
    "summary": {
      "totalFailedProducts": 370,
      "reimported": 259,
      "stillFailed": 111
    }
  }
}
```