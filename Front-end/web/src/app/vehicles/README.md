# Vehicles Pages

This directory contains pages related to vehicle-based navigation and product browsing.

## Pages

### Vehicles Index Page (`page.tsx`)
A dedicated page for browsing vehicles by make. Displays a responsive grid layout with vehicle cards that link to vehicle-specific product pages.

Features:
- Fetches vehicle makes from backend API
- Responsive grid layout
- Loading states and error handling
- Links to vehicle-specific product pages

### Vehicle-Specific Product Pages (`[make]/page.tsx`)
Dynamic routes for each vehicle make that display products filtered by vehicle compatibility.

Features:
- Dynamic routing based on vehicle make
- Product listings filtered by vehicle compatibility
- Breadcrumb navigation
- Sorting options
- Pagination support
- Loading states and error handling

## Integration

These pages work with the following API endpoints:
- `/vehicles/makes` - Fetch all vehicle makes
- `/products` - Fetch products with vehicle filtering parameters

The products API supports vehicle filtering with these parameters:
- `vehicleMake` - Filter by vehicle make
- `vehicleModel` - Filter by vehicle model (optional)