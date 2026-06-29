# Vehicle Page Migration Guide

## Overview

This guide explains how to update the vehicle pages (`/model/[slug]` and `/model/[slug]/page/[page]`) to use the new local vehicle-product mapping API instead of WordPress.

## Current vs. New Architecture

### Current Flow (WordPress-based)
```
User → Vehicle Page → wordpressService.getProductsByVehicle()
  → WordPress API → Filter by vehicle name → Return products
```

**Pain Points**:
- Multiple API calls to WordPress
- Text-based matching (inaccurate)
- No caching possible
- External dependency

### New Flow (Local Database)
```
User → Vehicle Page → vehicleService.getVehicleProducts()
  → Local API → Query by vehicle ID → Return products
```

**Benefits**:
- Single local API call
- Exact relationship matching
- Cacheable responses
- Fast, reliable queries

---

## Migration Strategies

### Strategy 1: Hybrid Mode (Recommended)

Use local API first, fall back to WordPress if needed. This provides safety during transition.

**Pros**:
- No disruption if local data is incomplete
- Easy rollback
- Gradual validation

**Cons**:
- Slightly more complex code
- Dual data paths to maintain temporarily

### Strategy 2: Direct Migration

Replace WordPress completely with local API.

**Pros**:
- Cleaner code
- Faster performance
- Forces data quality validation

**Cons**:
- Risk if migration incomplete
- No fallback option

---

## Implementation: Hybrid Mode

### Step 1: Import the Enhanced Service

The vehicleService already has the new method, no additional imports needed:

```typescript
import { vehicleService } from '@/services/vehicleService';
```

### Step 2: Update the Data Fetching Logic

**File**: `src/app/model/[slug]/page.tsx` (and `page/[page]/page.tsx`)

**Current Code** (around line 56-74):
```typescript
const [categoriesData, productsResponse, vehicleResponseRaw] = await Promise.all([
  wordpressService.getProductCategories(),
  wordpressService.getProductsByVehicle(slug, currentPage, itemsPerPage),
  apiClient.get(`/vehicles/slug/${slug}`).catch(err => {
    console.warn('Could not fetch vehicle data:', err);
    return { success: false };
  })
]);

const vehicleResponse: any = vehicleResponseRaw;

// Set categories
setCategories(categoriesData);

// Set products
let productsData = productsResponse.products || [];
const totalProductsFromAPI = productsResponse.total;
setProducts(productsData);
setTotalProductsFromAPI(totalProductsFromAPI);
```

**New Code (Hybrid Approach)**:
```typescript
// Fetch vehicle data and categories
const [vehicleResponseRaw, categoriesData] = await Promise.all([
  apiClient.get(`/vehicles/slug/${slug}`).catch(err => {
    console.warn('Could not fetch vehicle data:', err);
    return { success: false };
  }),
  wordpressService.getProductCategories() // Keep categories from WP for now
]);

const vehicleResponse: any = vehicleResponseRaw;

// Set vehicle data
if (vehicleResponse.success && vehicleResponse.vehicle) {
  setVehicle(vehicleResponse.vehicle);
}

// Set categories
setCategories(categoriesData);

// Try to fetch products from local API first
let productsData = [];
let totalProductsFromAPI = 0;
let usedLocalAPI = false;

if (vehicleResponse.success && vehicleResponse.vehicle) {
  try {
    console.log('Fetching products from local API...');
    const localResult = await vehicleService.getVehicleProducts(slug, {
      page: currentPage,
      limit: itemsPerPage,
      category: selectedCategory || undefined,
      sortBy: mapSortBy(currentSort), // Helper function to map sort values
      order: getSortOrder(currentSort) // Helper function to get order
    });
    
    if (localResult.success && localResult.products && localResult.products.length > 0) {
      productsData = localResult.products;
      totalProductsFromAPI = localResult.total || localResult.products.length;
      usedLocalAPI = true;
      console.log(`✓ Loaded ${productsData.length} products from local API`);
    } else {
      console.log('Local API returned no products, falling back to WordPress');
    }
  } catch (error) {
    console.warn('Error fetching from local API, falling back to WordPress:', error);
  }
}

// Fallback to WordPress if local API didn't work
if (!usedLocalAPI) {
  console.log('Using WordPress API for products...');
  const productsResponse = await wordpressService.getProductsByVehicle(
    slug,
    currentPage,
    itemsPerPage
  );
  productsData = productsResponse.products || [];
  totalProductsFromAPI = productsResponse.total;
}

setProducts(productsData);
setTotalProductsFromAPI(totalProductsFromAPI);
```

### Step 3: Add Helper Functions

Add these helper functions at the top of the component (outside the main function):

```typescript
/**
 * Map frontend sort values to API sort fields
 */
function mapSortBy(sortValue: string): string {
  const sortMap: Record<string, string> = {
    'date': 'createdAt',
    'price_asc': 'price',
    'price_desc': 'price',
    'name_asc': 'name',
    'rating': 'averageRating'
  };
  return sortMap[sortValue] || 'createdAt';
}

/**
 * Get sort order from sort value
 */
function getSortOrder(sortValue: string): 'asc' | 'desc' {
  if (sortValue.includes('asc')) return 'asc';
  if (sortValue.includes('desc')) return 'desc';
  return 'desc'; // default
}
```

### Step 4: Update Category Filtering

The local API handles category filtering server-side, so we need to adjust the client-side logic:

**Current Code**:
```typescript
const filteredProducts = selectedCategory 
  ? products.filter(product => 
      product.categories.some(cat => cat.slug === selectedCategory)
    )
  : products;
```

**New Code**:
```typescript
// When using local API, filtering is done server-side
// So we just use the products as-is
const filteredProducts = products;
```

**Important**: When category filter changes, re-fetch from API:

```typescript
const handleCategoryChange = (categorySlug: string) => {
  setSelectedCategory(categorySlug);
  // The useEffect will re-run and fetch with new category filter
};
```

### Step 5: Add Monitoring/Logging

Add a state to track which API is being used:

```typescript
const [dataSource, setDataSource] = useState<'local' | 'wordpress'>('local');
```

Update when fetching:

```typescript
if (usedLocalAPI) {
  setDataSource('local');
  console.log(`✓ Loaded ${productsData.length} products from local API`);
} else {
  setDataSource('wordpress');
  console.log(`✓ Loaded ${productsData.length} products from WordPress API`);
}
```

Optionally, display this to admins for monitoring:

```typescript
{process.env.NODE_ENV === 'development' && (
  <div className="fixed bottom-4 right-4 bg-gray-800 text-white px-3 py-2 rounded text-xs">
    Data Source: {dataSource.toUpperCase()}
  </div>
)}
```

---

## Implementation: Direct Migration

For direct migration (after validating hybrid mode works well):

### Simplified Fetch Logic

```typescript
// Fetch vehicle data and categories
const [vehicleResponseRaw, categoriesData] = await Promise.all([
  apiClient.get(`/vehicles/slug/${slug}`).catch(err => {
    console.warn('Could not fetch vehicle data:', err);
    return { success: false };
  }),
  apiClient.get('/categories') // Use local categories instead
]);

const vehicleResponse: any = vehicleResponseRaw;

if (!vehicleResponse.success || !vehicleResponse.vehicle) {
  setError('Vehicle not found');
  setLoading(false);
  return;
}

setVehicle(vehicleResponse.vehicle);
setCategories(categoriesData.categories || []);

// Fetch products from local API
const localResult = await vehicleService.getVehicleProducts(slug, {
  page: currentPage,
  limit: itemsPerPage,
  category: selectedCategory || undefined,
  sortBy: mapSortBy(currentSort),
  order: getSortOrder(currentSort)
});

if (localResult.success) {
  setProducts(localResult.products || []);
  setTotalProductsFromAPI(localResult.total || 0);
} else {
  setError('Failed to load products');
  setProducts([]);
}
```

---

## Data Structure Compatibility

### WordPress Product Structure
```typescript
interface WordPressProduct {
  id: number;
  name: string;
  price: string;
  regular_price: string;
  images: Array<{ src: string; alt: string }>;
  categories: Array<{ id: number; name: string; slug: string }>;
  stock_status: string;
  permalink: string;
  average_rating: string;
  // ...
}
```

### Local API Product Structure
```typescript
interface LocalProduct {
  _id: string;
  name: string;
  price: number;
  originalPrice?: number;
  images: Array<{ url: string; alt: string; isPrimary: boolean }>;
  categories: Array<{ _id: string; name: string; slug: string }>;
  stock: number;
  averageRating: number;
  // ...
}
```

### Compatibility Adapter (if needed)

If you want to keep the same interface on the frontend:

```typescript
function adaptLocalProductToWP(localProduct: any): any {
  return {
    id: localProduct._id,
    name: localProduct.name,
    price: localProduct.price.toString(),
    regular_price: localProduct.originalPrice?.toString() || localProduct.price.toString(),
    images: localProduct.images.map((img: any) => ({
      src: img.url,
      alt: img.alt
    })),
    categories: localProduct.categories,
    stock_status: localProduct.stock > 0 ? 'instock' : 'outofstock',
    permalink: `/products/${localProduct._id}`,
    average_rating: localProduct.averageRating.toString(),
    featured: localProduct.isFeatured,
    on_sale: localProduct.originalPrice > localProduct.price
  };
}

// Use it:
const adaptedProducts = localResult.products.map(adaptLocalProductToWP);
setProducts(adaptedProducts);
```

---

## Testing Checklist

After updating the vehicle pages:

### Functional Testing
- [ ] Vehicle page loads without errors
- [ ] Products display correctly
- [ ] Product images load
- [ ] Product names and prices show correctly
- [ ] "Add to Cart" button works
- [ ] Wishlist toggle works
- [ ] Product links navigate correctly

### Filtering & Sorting
- [ ] Category filter works
- [ ] Selected category highlights correctly
- [ ] Product counts per category are accurate
- [ ] Sort by price (ascending/descending) works
- [ ] Sort by name works
- [ ] Sort by rating works
- [ ] Sort by date works

### Pagination
- [ ] Page 1 loads correctly
- [ ] Next page button works
- [ ] Previous page button works
- [ ] Page number buttons work
- [ ] Last page loads correctly
- [ ] Product count matches total

### Edge Cases
- [ ] Invalid vehicle slug shows error
- [ ] No products for vehicle shows message
- [ ] Empty category filter works
- [ ] API error triggers fallback (hybrid mode)
- [ ] Loading states display correctly

### Performance
- [ ] Page loads faster than WordPress version
- [ ] No console errors
- [ ] No memory leaks on page navigation
- [ ] Smooth transitions between pages

---

## Rollback Procedure

If issues arise after migration:

### Quick Rollback (Hybrid Mode)

Simply comment out the local API attempt:

```typescript
// Try to fetch products from local API first
/*
let usedLocalAPI = false;
if (vehicleResponse.success && vehicleResponse.vehicle) {
  try {
    const localResult = await vehicleService.getVehicleProducts(slug, {...});
    if (localResult.success && localResult.products && localResult.products.length > 0) {
      productsData = localResult.products;
      totalProductsFromAPI = localResult.total || localResult.products.length;
      usedLocalAPI = true;
    }
  } catch (error) {
    console.warn('Error fetching from local API:', error);
  }
}
*/

// Directly use WordPress
const productsResponse = await wordpressService.getProductsByVehicle(
  slug,
  currentPage,
  itemsPerPage
);
productsData = productsResponse.products || [];
totalProductsFromAPI = productsResponse.total;
```

### Full Rollback (Direct Mode)

Use git to revert the changes:

```bash
git diff HEAD src/app/model/[slug]/page.tsx
git checkout src/app/model/[slug]/page.tsx
```

---

## Monitoring & Analytics

### Add Tracking

Track which API is being used:

```typescript
useEffect(() => {
  if (dataSource) {
    // Send analytics event
    if (typeof window !== 'undefined' && (window as any).gtag) {
      (window as any).gtag('event', 'vehicle_page_data_source', {
        source: dataSource,
        vehicle_slug: slug,
        page: currentPage
      });
    }
  }
}, [dataSource, slug, currentPage]);
```

### Performance Monitoring

```typescript
const startTime = performance.now();

// ... fetch data ...

const endTime = performance.now();
const loadTime = endTime - startTime;

console.log(`Page load time: ${loadTime.toFixed(2)}ms using ${dataSource}`);

// Send to analytics
if (typeof window !== 'undefined' && (window as any).gtag) {
  (window as any).gtag('event', 'timing_complete', {
    name: 'vehicle_page_load',
    value: Math.round(loadTime),
    event_category: dataSource
  });
}
```

---

## Best Practices

1. **Start with Hybrid Mode**: Always implement hybrid approach first
2. **Monitor Closely**: Track which API is being used and performance
3. **Validate Data**: Spot-check several vehicles before full rollout
4. **Gradual Rollout**: Start with less popular vehicles
5. **Keep Fallback**: Maintain WordPress fallback for at least 1-2 weeks
6. **User Feedback**: Gather feedback from users and admins
7. **Performance Baseline**: Compare load times before/after
8. **Error Tracking**: Monitor error rates closely

---

## Expected Improvements

After migration, you should see:

- **Performance**: 50-70% faster page loads
- **Reliability**: 99%+ uptime (vs. external API dependency)
- **Accuracy**: 100% accurate vehicle-product associations
- **Cacheability**: Responses can be cached effectively
- **Control**: Full control over data and relationships

---

## Next Steps

1. **Implement Hybrid Mode**: Update vehicle pages with hybrid approach
2. **Test Thoroughly**: Run through testing checklist
3. **Monitor**: Track usage and performance for 1-2 weeks
4. **Validate Data**: Ensure migration created correct associations
5. **Direct Migration**: Remove WordPress fallback when confident
6. **Optimize**: Implement caching layer
7. **Enhance**: Build admin UI for managing mappings

---

## Support

Questions or issues? Check:
- [Implementation Summary](../../../VEHICLE_PRODUCT_MAPPING_IMPLEMENTATION_SUMMARY.md)
- [Quick Start Guide](../../../VEHICLE_PRODUCT_MAPPING_QUICK_START.md)
- Backend API documentation
- Browser console for errors
- Migration reports for data validation
