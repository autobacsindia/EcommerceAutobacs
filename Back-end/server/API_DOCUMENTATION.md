# Autobacs India API Documentation

## Base URL
`http://localhost:5000` (Development)

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

### Auth Routes (`/auth`)
- `POST /auth/register` - Register new user
- `POST /auth/login` - Login user
- `GET /auth/profile` - Get authenticated user profile
- `PUT /auth/profile` - Update user profile

### Product Routes (`/products`)
- `GET /products` - List products with filtering/pagination
- `GET /products/:id` - Get product by ID
- `GET /products/featured` - Get featured products
- `GET /products/suggestions` - Get search suggestions

### Review Routes (`/reviews`)
- `GET /reviews/products/:productId` - Get all approved reviews for a product
- `GET /reviews/products/:productId/summary` - Get review summary for a product
- `POST /reviews/products/:productId` - Submit a new review for a product
- `PUT /reviews/:reviewId` - Update own review
- `DELETE /reviews/:reviewId` - Delete own review
- `POST /reviews/:reviewId/helpful` - Mark a review as helpful

### Category Routes (`/categories`)
- `GET /categories` - List categories
- `GET /categories/:id` - Get category by ID
- `GET /categories/:slug` - Get category by slug
- `GET /categories/hierarchical` - Get hierarchical category tree

### Vehicle Routes (`/vehicles`)
- `GET /vehicles` - List vehicles
- `GET /vehicles/:id` - Get vehicle by ID
- `GET /vehicles/slug/:slug` - Get vehicle by slug
- `GET /vehicles/makes` - Get all vehicle makes
- `GET /vehicles/models/:make` - Get models for a specific make
- `POST /vehicles` - Create new vehicle (admin)
- `PUT /vehicles/:id` - Update vehicle (admin)
- `DELETE /vehicles/:id` - Delete vehicle (admin)

### Cart Routes (`/cart`)
- `GET /cart` - Get user's cart
- `POST /cart/add` - Add item to cart
- `PUT /cart/update` - Update cart item quantity
- `DELETE /cart/remove` - Remove item from cart
- `DELETE /cart/clear` - Clear entire cart

### Wishlist Routes (`/wishlist`)
- `GET /wishlist` - Get all user's wishlists
- `GET /wishlist/:id` - Get specific wishlist
- `POST /wishlist` - Create new wishlist
- `PUT /wishlist/:id` - Update wishlist details
- `DELETE /wishlist/:id` - Delete wishlist
- `POST /wishlist/:id/items` - Add item to wishlist
- `DELETE /wishlist/:id/items/:productId` - Remove item from wishlist
- `DELETE /wishlist/:id/clear` - Clear entire wishlist
- `POST /wishlist/:id/share` - Share wishlist with users or make public
- `DELETE /wishlist/:id/share/:userId` - Revoke user access to shared wishlist
- `GET /wishlist/:id/export` - Export wishlist as JSON
- `POST /wishlist/import` - Import wishlist from JSON

## Admin Endpoints

### Product Management (`/products`)
- `POST /products` - Create new product
- `PUT /products/:id` - Update product
- `DELETE /products/:id` - Delete product
- `GET /products/analytics` - Get search analytics

### Category Management (`/categories`)
- `POST /categories` - Create new category
- `PUT /categories/:id` - Update category
- `DELETE /categories/:id` - Delete category

### Vehicle Management (`/vehicles`)
- `POST /vehicles` - Create new vehicle
- `PUT /vehicles/:id` - Update vehicle
- `DELETE /vehicles/:id` - Delete vehicle

### Order Management (`/orders`)
- `GET /orders` - List all orders
- `GET /orders/:id` - Get order by ID
- `PUT /orders/:id/status` - Update order status

### User Management (`/users`)
- `GET /users` - List all users
- `GET /users/:id` - Get user by ID
- `PUT /users/:id` - Update user
- `DELETE /users/:id` - Delete user

### Review Management (`/reviews`)
- `GET /reviews/admin` - Get all reviews (admin)
- `PUT /reviews/:reviewId/approve` - Approve a review (admin)
- `PUT /reviews/:reviewId/reject` - Reject a review (admin)
- `DELETE /reviews/:reviewId/admin` - Delete any review (admin)

## Search and Filtering Endpoints

### Enhanced Product Search (`/products`)
The `/products` endpoint now supports advanced search capabilities when Elasticsearch is available:
- Full-text search with relevance scoring
- Faceted filtering by category, brand, price range, rating, and availability
- Aggregation results for building filter UI components

#### Query Parameters
- `q` - Search query string
- `category` - Filter by category (comma-separated for multiple)
- `brand` - Filter by brand (comma-separated for multiple)
- `minPrice` - Minimum price filter
- `maxPrice` - Maximum price filter
- `inStock` - Filter for in-stock items only (`true`/`false`)
- `rating` - Minimum rating filter (comma-separated for multiple)
- `sortBy` - Sort field (`createdAt`, `price`, `averageRating`, etc.)
- `order` - Sort order (`asc`/`desc`)
- `page` - Page number for pagination (default: 1)
- `limit` - Results per page (default: 12)

#### Response Format
When Elasticsearch is available, the response includes faceted search data:
```json
{
  "success": true,
  "count": 12,
  "total": 125,
  "pages": 11,
  "currentPage": 1,
  "hasNext": true,
  "hasPrev": false,
  "products": [...],
  "facets": {
    "categories": [...],
    "brands": [...],
    "priceRanges": [...],
    "ratingRanges": [...],
    "availability": [...]
  }
}
```

### Search Suggestions (`/products/suggestions`)
Provides autocomplete suggestions for search queries.

#### Query Parameters
- `q` - Partial search query (required)
- `limit` - Maximum number of suggestions (default: 10)

#### Response Format
```json
{
  "success": true,
  "suggestions": [
    {
      "id": "product-123",
      "text": "Product Name",
      "type": "product",
      "category": "Category Name"
    },
    {
      "id": "brand-nike",
      "text": "Nike",
      "type": "brand"
    }
  ]
}
```

### Search Analytics (`/products/analytics`)
Provides insights into search behavior (Admin only).

#### Query Parameters
- `startDate` - Analytics start date (ISO format)
- `endDate` - Analytics end date (ISO format)

#### Response Format
```json
{
  "success": true,
  "analytics": {
    "popularTerms": [
      {
        "term": "running shoes",
        "count": 42
      }
    ],
    "searchesOverTime": [
      {
        "date": "2023-01-01T00:00:00.000Z",
        "count": 15
      }
    ]
  }
}
```

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