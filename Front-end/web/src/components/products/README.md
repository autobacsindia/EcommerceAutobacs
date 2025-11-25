# Product Components

This directory contains components related to product display and filtering.

## Components

### ProductGrid
Displays a grid of products with enhanced visual treatments including badges for New, Sale, and Popular items. Shows both original and sale prices when applicable.

**Props:**
- `products`: Array of product objects to display

### ProductFilters
Provides filtering capabilities for products including categories, price range, availability, ratings, and brands.

Enhanced features:
- Brand filtering
- Improved UI with loading states
- Better filter persistence

### FeaturedProducts
Displays a section of featured products with loading states and error handling.

## Integration

These components work with the following API endpoints:
- `/products` - Fetch products with various filter parameters
- `/categories` - Fetch product categories

The products API supports the following filter parameters:
- `category` - Filter by category ID
- `minPrice`/`maxPrice` - Filter by price range
- `inStock` - Filter for in-stock items only
- `rating` - Filter by minimum rating
- `brand` - Filter by brand
- `vehicleMake`/`vehicleModel` - Filter by vehicle compatibility