# Reviews API Documentation

## Overview
The Reviews API provides endpoints for managing product reviews, including submission, retrieval, and administrative approval workflows.

## Base URL
`http://localhost:5000/reviews`

## Authentication
Most endpoints require authentication via JWT tokens. Tokens are issued upon successful login/register and should be included in the Authorization header:
```
Authorization: Bearer <token>
```

## Rate Limiting
API endpoints are rate-limited to prevent abuse:
- Auth endpoints: 10 requests per 15 minutes
- All other endpoints: 100 requests per 15 minutes

## Public Endpoints

### Get Product Reviews
```
GET /products/:productId
```

**Description:** Retrieve all approved reviews for a specific product with filtering and sorting options.

**Parameters:**
- `productId` (path): ID of the product
- `page` (query): Page number for pagination (default: 1)
- `limit` (query): Number of reviews per page (default: 10, max: 50)
- `sortBy` (query): Sort field (`createdAt`, `rating`, `helpfulCount`)
- `order` (query): Sort order (`asc`, `desc`)
- `minRating` (query): Minimum rating filter (1-5)
- `maxRating` (query): Maximum rating filter (1-5)
- `hasImages` (query): Filter reviews with images only (`true`/`false`)

**Response:**
```json
{
  "success": true,
  "count": 25,
  "pagination": {
    "currentPage": 1,
    "totalPages": 3,
    "totalReviews": 25,
    "hasNext": true,
    "hasPrev": false
  },
  "reviews": [
    {
      "id": "review_id",
      "user": {
        "id": "user_id",
        "name": "John Doe"
      },
      "rating": 4,
      "title": "Great product!",
      "comment": "This product exceeded my expectations...",
      "images": [
        {
          "url": "image_url",
          "alt": "Review image"
        }
      ],
      "isVerifiedPurchase": true,
      "helpfulCount": 12,
      "createdAt": "2023-01-01T00:00:00Z"
    }
  ]
}
```

### Get Product Review Summary
```
GET /products/:productId/summary
```

**Description:** Retrieve summary statistics for a product's reviews.

**Response:**
```json
{
  "success": true,
  "summary": {
    "averageRating": 4.2,
    "totalReviews": 25,
    "ratingDistribution": {
      "5": 10,
      "4": 8,
      "3": 4,
      "2": 2,
      "1": 1
    }
  }
}
```

## Authenticated User Endpoints

### Submit Product Review
```
POST /products/:productId
```

**Description:** Submit a new review for a product (must be authenticated).

**Request Body:**
```json
{
  "rating": 5,
  "title": "Excellent quality",
  "comment": "This product is amazing...",
  "images": [
    {
      "url": "image_url",
      "alt": "Review image"
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "message": "Review submitted successfully and pending approval",
  "review": {
    "id": "review_id",
    "rating": 5,
    "title": "Excellent quality",
    "comment": "This product is amazing...",
    "images": [
      {
        "url": "image_url",
        "alt": "Review image"
      }
    ],
    "isApproved": false,
    "createdAt": "2023-01-01T00:00:00Z"
  }
}
```

### Update Own Review
```
PUT /:reviewId
```

**Description:** Update an existing review (owner only).

**Request Body:**
```json
{
  "rating": 4,
  "title": "Updated review title",
  "comment": "Updated review content..."
}
```

**Response:**
```json
{
  "success": true,
  "message": "Review updated successfully",
  "review": {
    "id": "review_id",
    "rating": 4,
    "title": "Updated review title",
    "comment": "Updated review content...",
    "isApproved": false,
    "updatedAt": "2023-01-02T00:00:00Z"
  }
}
```

### Delete Own Review
```
DELETE /:reviewId
```

**Description:** Delete an existing review (owner only).

**Response:**
```json
{
  "success": true,
  "message": "Review deleted successfully"
}
```

### Mark Review as Helpful
```
POST /:reviewId/helpful
```

**Description:** Mark a review as helpful (authenticated users only).

**Response:**
```json
{
  "success": true,
  "message": "Review marked as helpful",
  "helpfulCount": 13
}
```

## Administrator Endpoints

### Get All Reviews (with filters)
```
GET /admin
```

**Description:** Retrieve all reviews with admin filtering options.

**Parameters:**
- `page` (query): Page number for pagination (default: 1)
- `limit` (query): Number of reviews per page (default: 10)
- `status` (query): Filter by approval status (`approved`, `pending`, `all`)
- `productId` (query): Filter by specific product
- `userId` (query): Filter by specific user
- `sortBy` (query): Sort field (`createdAt`, `rating`)
- `order` (query): Sort order (`asc`, `desc`)

### Approve Review
```
PUT /:reviewId/approve
```

**Description:** Approve a pending review.

**Response:**
```json
{
  "success": true,
  "message": "Review approved successfully",
  "review": {
    "id": "review_id",
    "isApproved": true,
    "updatedAt": "2023-01-02T00:00:00Z"
  }
}
```

### Reject Review
```
PUT /:reviewId/reject
```

**Description:** Reject a pending review.

**Response:**
```json
{
  "success": true,
  "message": "Review rejected successfully",
  "review": {
    "id": "review_id",
    "isApproved": false,
    "updatedAt": "2023-01-02T00:00:00Z"
  }
}
```

### Delete Any Review
```
DELETE /:reviewId/admin
```

**Description:** Delete any review (admin only).

**Response:**
```json
{
  "success": true,
  "message": "Review deleted successfully"
}
```

## Validation Rules

### Review Submission Validation
1. **Rating:** Required, integer between 1-5
2. **Title:** Optional, max 100 characters
3. **Comment:** Required, max 1000 characters
4. **Images:** Optional, max 5 images per review
5. **Duplicate Prevention:** One review per user per product (enforced by database index)

### Image Validation
1. **URL:** Valid URL format
2. **Alt Text:** Optional but recommended for accessibility

## Error Responses
All error responses follow this format:
```json
{
  "success": false,
  "message": "Error description"
}
```

Status codes:
- 400: Bad Request
- 401: Unauthorized
- 403: Forbidden
- 404: Not Found
- 429: Too Many Requests
- 500: Internal Server Error

## Common Error Cases
1. Attempting to submit multiple reviews for same product-user combination
2. Submitting review for non-existent product
3. Updating/deleting non-existent review
4. Unauthorized access to protected endpoints