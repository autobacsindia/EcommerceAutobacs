# Location Feature Integration Guide

## Overview

This guide shows how to integrate the location feature into your Autobacs frontend application.

## Files Created

### 1. Type Definitions
- **Location:** `src/types/location.ts` (282 lines)
  - Complete TypeScript types for all location features

### 2. Services
- **Location Service:** `src/services/locationService.ts` (370 lines)
  - API client for all location endpoints
  - Session management for guest users
  - Browser geolocation integration

### 3. Context
- **Location Context:** `src/contexts/LocationContext.tsx` (215 lines)
  - Global state management for location
  - React hooks for easy usage

### 4. Components
- **LocationDisplay:** `src/components/location/LocationDisplay.tsx` (116 lines)
  - Shows current location in header (compact mode)
  - Shows full location details (full mode)
  
- **LocationSelector:** `src/components/location/LocationSelector.tsx` (272 lines)
  - Modal for selecting/changing location
  - PIN code validation
  - Browser geolocation support
  
- **DeliveryEstimate:** `src/components/location/DeliveryEstimate.tsx` (151 lines)
  - Shows delivery time estimates
  - Zone badges
  - Compact and full modes

## Integration Steps

### Step 1: Wrap App with LocationProvider

Update your root layout to include the LocationProvider:

**File: `src/app/layout.tsx`**

```typescript
import { LocationProvider } from '@/contexts/LocationContext';
import { Toaster } from 'react-hot-toast'; // Already installed

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <LocationProvider>
          {/* Your existing layout components */}
          {children}
          
          {/* Toast notifications for location updates */}
          <Toaster position="top-center" />
        </LocationProvider>
      </body>
    </html>
  );
}
```

### Step 2: Add Location Display to Header

Find your existing header/navbar component and add the LocationDisplay:

**Example Integration:**

```typescript
'use client';

import LocationDisplay from '@/components/location/LocationDisplay';
import { MapPin } from 'lucide-react';

export default function Header() {
  return (
    <header className="bg-white shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <div className="flex-shrink-0">
            <h1 className="text-xl font-bold">Autobacs</h1>
          </div>

          {/* Location Display - Compact Mode for Header */}
          <LocationDisplay compact={true} />

          {/* Rest of header: Search, Cart, Profile, etc. */}
          <div className="flex items-center gap-4">
            {/* Your existing header items */}
          </div>
        </div>
      </div>
    </header>
  );
}
```

### Step 3: Add Location Display to Homepage

Show prominent location selection on the homepage:

**File: `src/app/page.tsx`**

```typescript
import LocationDisplay from '@/components/location/LocationDisplay';

export default function HomePage() {
  return (
    <div className="container mx-auto px-4 py-8">
      {/* Prominent Location Section */}
      <div className="mb-8">
        <LocationDisplay 
          compact={false} 
          showChangeButton={true}
        />
      </div>

      {/* Rest of homepage content */}
    </div>
  );
}
```

### Step 4: Add Delivery Estimates to Product Pages

Show delivery information on product detail pages:

**File: `src/app/products/[id]/page.tsx`**

```typescript
'use client';

import DeliveryEstimate from '@/components/location/DeliveryEstimate';
import { useLocation } from '@/contexts/LocationContext';

export default function ProductPage({ params }: { params: { id: string } }) {
  const { currentLocation } = useLocation();

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="grid md:grid-cols-2 gap-8">
        {/* Product Images */}
        <div>
          {/* Your product images */}
        </div>

        {/* Product Info */}
        <div>
          <h1 className="text-3xl font-bold mb-4">Product Name</h1>
          <p className="text-2xl font-semibold text-blue-600 mb-4">₹2,499</p>

          {/* Delivery Estimate */}
          {currentLocation && (
            <div className="mb-6 p-4 bg-gray-50 rounded-lg">
              <DeliveryEstimate 
                productId={params.id}
                showIcon={true}
                compact={false}
              />
            </div>
          )}

          {/* Add to Cart Button */}
          <button className="w-full bg-blue-600 text-white py-3 rounded-lg">
            Add to Cart
          </button>
        </div>
      </div>
    </div>
  );
}
```

### Step 5: Use Location in Product Listings

Add delivery badges to product cards:

**File: `src/components/ProductCard.tsx`**

```typescript
'use client';

import DeliveryEstimate from '@/components/location/DeliveryEstimate';

export default function ProductCard({ product }: { product: any }) {
  return (
    <div className="border rounded-lg p-4 hover:shadow-lg transition">
      {/* Product Image */}
      <img src={product.image} alt={product.name} className="w-full h-48 object-cover rounded mb-4" />
      
      {/* Product Name */}
      <h3 className="font-semibold mb-2">{product.name}</h3>
      
      {/* Price */}
      <p className="text-lg font-bold text-blue-600 mb-2">₹{product.price}</p>
      
      {/* Delivery Estimate - Compact Mode */}
      <DeliveryEstimate 
        productId={product._id}
        compact={true}
        showIcon={true}
      />
    </div>
  );
}
```

### Step 6: Checkout Integration

Add location validation in checkout:

**File: `src/app/checkout/page.tsx`**

```typescript
'use client';

import { useLocation } from '@/contexts/LocationContext';
import LocationDisplay from '@/components/location/LocationDisplay';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';

export default function CheckoutPage() {
  const { currentLocation } = useLocation();
  const router = useRouter();

  useEffect(() => {
    // Ensure location is selected before checkout
    if (!currentLocation) {
      toast.error('Please select a delivery location');
      router.push('/');
    }
  }, [currentLocation, router]);

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">Checkout</h1>

      {/* Delivery Location */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-3">Delivery Address</h2>
        <LocationDisplay 
          compact={false}
          showChangeButton={true}
        />
      </div>

      {/* Rest of checkout form */}
    </div>
  );
}
```

## Usage Examples

### Using Location Context

```typescript
'use client';

import { useLocation } from '@/contexts/LocationContext';

export default function MyComponent() {
  const {
    currentLocation,
    deliveryZone,
    deliveryEstimate,
    isLoading,
    error,
    selectLocation,
    clearLocation,
    validateAddress,
    refreshLocation
  } = useLocation();

  // Check if user has selected location
  if (!currentLocation) {
    return <div>Please select your location</div>;
  }

  // Show delivery info
  return (
    <div>
      <p>Delivering to: {currentLocation.selectedAddress.city}</p>
      <p>PIN Code: {currentLocation.selectedAddress.postalCode}</p>
      {deliveryZone && (
        <p>Delivery: {deliveryZone.deliveryTime.minDays}-{deliveryZone.deliveryTime.maxDays} days</p>
      )}
    </div>
  );
}
```

### Using Location Display Hook

```typescript
'use client';

import { useLocationDisplay } from '@/contexts/LocationContext';

export default function QuickLocation() {
  const { locationText, deliveryText, hasLocation } = useLocationDisplay();

  return (
    <div>
      {hasLocation ? (
        <>
          <p>{locationText}</p>
          <p>Delivery: {deliveryText}</p>
        </>
      ) : (
        <p>No location selected</p>
      )}
    </div>
  );
}
```

### Manual Location Selection

```typescript
'use client';

import { useLocation } from '@/contexts/LocationContext';

export default function LocationForm() {
  const { selectLocation, isLoading } = useLocation();
  const [pinCode, setPinCode] = useState('');

  const handleSubmit = async () => {
    try {
      await selectLocation({
        address: `PIN Code ${pinCode}, India`
      });
      alert('Location updated!');
    } catch (error) {
      alert('Failed to update location');
    }
  };

  return (
    <div>
      <input 
        value={pinCode}
        onChange={(e) => setPinCode(e.target.value)}
        placeholder="Enter PIN code"
      />
      <button onClick={handleSubmit} disabled={isLoading}>
        {isLoading ? 'Updating...' : 'Update Location'}
      </button>
    </div>
  );
}
```

## Styling

The components use Tailwind CSS classes. Ensure these are available in your `tailwind.config.ts`:

```typescript
export default {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      // Your theme extensions
    },
  },
}
```

## Environment Variables

No additional environment variables needed for basic functionality. The backend API URL is handled by the existing `apiClient`.

## Testing

### Test Location Feature

1. **Start backend:**
   ```bash
   cd Autobacs/Back-end/server
   npm run dev
   ```

2. **Start frontend:**
   ```bash
   cd Autobacs/Front-end/web
   npm run dev
   ```

3. **Test scenarios:**
   - Open app → Click location display → Enter PIN code (e.g., 400001)
   - Verify location is shown in header
   - Check delivery estimates on product pages
   - Test browser geolocation (click "Use My Current Location")
   - Refresh page → Location should persist

### Test PIN Codes (From Seeded Data)

- **Mumbai:** 400001, 400002, 400093 (Metro - 2-3 days)
- **Delhi:** 110001, 110002 (Metro - 2-3 days)
- **Bangalore:** 560001, 560100 (Metro - 2-3 days)
- **Jaipur:** 302001 (Tier-1 - 3-4 days)

## Troubleshooting

### Issue: Location not persisting
**Solution:** Check browser localStorage. The session ID should be stored.

### Issue: API errors
**Solution:** Ensure backend is running and seeded with data:
```bash
node seed-delivery-zones.js
node seed-sample-warehouses.js
```

### Issue: Geolocation not working
**Solution:** Ensure HTTPS or localhost. Browsers block geolocation on HTTP.

### Issue: Types not found
**Solution:** Ensure `tsconfig.json` has proper paths:
```json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

## Next Steps

1. **Add location prompt on first visit** - Show modal automatically
2. **Add recent locations** - Show user's location history
3. **Add Google Maps autocomplete** - For better address search
4. **Add warehouse info** - Show which warehouse is fulfilling
5. **Add location-based filtering** - Filter products by availability

## Support

For issues or questions:
- Check `LOCATION_SERVICE_API_DOCS.md` for API reference
- Check `LOCATION_SERVICE_README.md` for backend setup
- Review component source code for implementation details

---

**Created:** December 2, 2025  
**Status:** Complete and Ready to Use
