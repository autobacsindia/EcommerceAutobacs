# Wishlist API Documentation

## Overview
The Wishlist API provides endpoints for managing user wishlists with features including CRUD operations, validation, sharing, and import/export functionality.

## Authentication
All wishlist endpoints require authentication via JWT Bearer token in the Authorization header:
```
Authorization: Bearer <your-jwt-token>
```

## Endpoints

### Get All Wishlists
**GET** `/wishlist`

Retrieves all wishlists for the authenticated user.

**Response:**
```json
{
  "success": true,
  "count": 2,
  "wishlists": [
    {
      "_id": "wishlist-id",
      "user": "user-id",
      "name": "My Wishlist",
      "description": "My favorite items",
      "privacy": "private",
      "items": [],
      "createdAt": "2023-01-01T00:00:00.000Z",
      "updatedAt": "2023-01-01T00:00:00.000Z"
    }
  ]
}
```

### Get Specific Wishlist
**GET** `/wishlist/:id`

Retrieves a specific wishlist by ID.

**Query Parameters:**
- `token` (optional): Share token for accessing public/shared wishlists

**Response:**
```json
{
  "success": true,
  "wishlist": {
    "_id": "wishlist-id",
    "user": "user-id",
    "name": "My Wishlist",
    "description": "My favorite items",
    "privacy": "private",
    "items": [
      {
        "product": {
          "_id": "product-id",
          "name": "Product Name",
          "price": 99.99
        },
        "addedAt": "2023-01-01T00:00:00.000Z",
        "notes": "Special notes"
      }
    ],
    "createdAt": "2023-01-01T00:00:00.000Z",
    "updatedAt": "2023-01-01T00:00:00.000Z"
  }
}
```

### Create New Wishlist
**POST** `/wishlist`

Creates a new wishlist for the authenticated user.

**Request Body:**
```json
{
  "name": "My New Wishlist",        // Required, 1-50 characters
  "description": "Description",     // Optional, max 500 characters
  "privacy": "private"              // Optional, one of: private, public, shared
}
```

**Response:**
```json
{
  "success": true,
  "wishlist": {
    "_id": "wishlist-id",
    "user": "user-id",
    "name": "My New Wishlist",
    "description": "Description",
    "privacy": "private",
    "items": [],
    "createdAt": "2023-01-01T00:00:00.000Z",
    "updatedAt": "2023-01-01T00:00:00.000Z"
  }
}
```

### Update Wishlist
**PUT** `/wishlist/:id`

Updates an existing wishlist.

**Request Body:**
```json
{
  "name": "Updated Wishlist Name",  // Optional
  "description": "New description", // Optional
  "privacy": "public"               // Optional
}
```

**Response:**
```json
{
  "success": true,
  "wishlist": {
    "_id": "wishlist-id",
    "user": "user-id",
    "name": "Updated Wishlist Name",
    "description": "New description",
    "privacy": "public",
    "items": [],
    "createdAt": "2023-01-01T00:00:00.000Z",
    "updatedAt": "2023-01-01T00:00:00.000Z"
  }
}
```

### Delete Wishlist
**DELETE** `/wishlist/:id`

Deletes a wishlist and all its items.

**Response:**
```json
{
  "success": true,
  "message": "Wishlist deleted successfully"
}
```

### Add Item to Wishlist
**POST** `/wishlist/:id/items`

Adds a product to a wishlist.

**Request Body:**
```json
{
  "productId": "product-id",  // Required
  "notes": "Special notes"    // Optional, max 200 characters
}
```

**Response:**
```json
{
  "success": true,
  "message": "Item added to wishlist",
  "wishlist": {
    // Updated wishlist object
  }
}
```

### Remove Item from Wishlist
**DELETE** `/wishlist/:id/items/:productId`

Removes a product from a wishlist.

**Response:**
```json
{
  "success": true,
  "message": "Item removed from wishlist",
  "wishlist": {
    // Updated wishlist object
  }
}
```

### Clear Wishlist
**DELETE** `/wishlist/:id/clear`

Removes all items from a wishlist.

**Response:**
```json
{
  "success": true,
  "message": "Wishlist cleared",
  "wishlist": {
    // Updated wishlist object with empty items array
  }
}
```

### Share Wishlist
**POST** `/wishlist/:id/share`

Shares a wishlist publicly or with specific users.

**Request Body:**
```json
{
  "isPublic": true,           // Make wishlist public with share link
  "userIds": ["user-id-1"],   // Share with specific users
  "role": "viewer"            // Role for shared users: viewer or editor
}
```

**Response:**
```json
{
  "success": true,
  "message": "Wishlist is now public",
  "shareLink": "http://example.com/api/wishlist/wishlist-id?token=share-token",
  "wishlist": {
    // Updated wishlist object
  }
}
```

### Revoke User Access
**DELETE** `/wishlist/:id/share/:userId`

Revokes a user's access to a shared wishlist.

**Response:**
```json
{
  "success": true,
  "message": "User access revoked",
  "wishlist": {
    // Updated wishlist object
  }
}
```

### Export Wishlist
**GET** `/wishlist/:id/export`

Exports a wishlist as JSON data.

**Response:**
Returns a JSON file download with the wishlist data.

### Import Wishlist
**POST** `/wishlist/import`

Imports a wishlist from JSON data.

**Request Body:**
```json
{
  "wishlistData": {
    "name": "Imported Wishlist",
    "description": "Imported description",
    "privacy": "private",
    "items": [
      {
        "productId": "product-id",
        "notes": "Imported notes",
        "addedAt": "2023-01-01T00:00:00.000Z"
      }
    ]
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Wishlist imported successfully",
  "wishlist": {
    // Created wishlist object
  }
}
```

## Validation Rules

### Wishlist Validation
- **name**: Required, 1-50 characters
- **description**: Optional, max 500 characters
- **privacy**: Optional, must be one of: private, public, shared

### Item Validation
- **productId**: Required
- **notes**: Optional, max 200 characters

### Sharing Validation
- **isPublic**: Optional, boolean
- **userIds**: Optional, array of user IDs
- **role**: Optional, must be one of: viewer, editor

## Error Responses

### Common Error Codes
- **400**: Bad Request - Validation failed or missing required data
- **401**: Unauthorized - Missing or invalid authentication token
- **404**: Not Found - Wishlist or product not found
- **409**: Conflict - Wishlist with this name already exists

### Error Response Format
```json
{
  "success": false,
  "message": "Error description",
  "errors": [
    {
      "msg": "Validation error message",
      "param": "field-name",
      "location": "body"
    }
  ]
}
```