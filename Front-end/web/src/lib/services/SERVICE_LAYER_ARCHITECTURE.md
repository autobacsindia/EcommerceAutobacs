# Service Layer Architecture Guide

## 🏗️ Three-Layer Architecture

The frontend uses a proper layered architecture to decouple the UI from the backend API:

```
┌─────────────────────────────────────────┐
│  UI Layer (Components/Pages)            │
│  - Never calls apiClient directly       │
│  - Only calls service methods           │
│  - Clean, readable code                 │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│  Service Layer (Business Logic)         │
│  - Abstracts API endpoints              │
│  - Handles caching                      │
│  - Transforms data                      │
│  - Domain-specific methods              │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│  Transport Layer (apiClient)            │
│  - HTTP requests                        │
│  - Authentication                       │
│  - Token refresh                        │
│  - Error handling                       │
└─────────────────────────────────────────┘
```

## ✅ Correct Usage

### Component Using Service (✅ CORRECT)

```typescript
import { ProductService } from '@/lib/services';

export default function ProductList() {
  const [products, setProducts] = useState([]);

  useEffect(() => {
    async function fetchProducts() {
      const data = await ProductService.getAll({ page: 1, limit: 20 });
      setProducts(data.products);
    }
    fetchProducts();
  }, []);

  return <div>{/* Render products */}</div>;
}
```

### Component Using apiClient Directly (❌ WRONG)

```typescript
import apiClient from '@/lib/api'; // ❌ Don't do this in components!

export default function ProductList() {
  const [products, setProducts] = useState([]);

  useEffect(() => {
    async function fetchProducts() {
      const data = await apiClient.get('/products?page=1&limit=20'); // ❌ Leaks backend structure
      setProducts(data.products);
    }
    fetchProducts();
  }, []);

  return <div>{/* Render products */}</div>;
}
```

## 📁 Service Files

### Existing Services

| Service | File | Purpose |
|---------|------|---------|
| ProductService | `lib/services/productService.ts` | Product listings, search, brands |
| OrderService | `lib/services/orderService.ts` | Order management, checkout |
| ReviewService | `lib/services/reviewService.ts` | Product reviews and ratings |
| LocationService | `lib/services/locationService.ts` | Location, delivery estimates |
| ContactService | `lib/services/contactService.ts` | Contact form submissions |
| ConsultationService | `lib/services/consultationService.ts` | Consultation bookings |
| VehicleService | `services/vehicleService.ts` | Vehicle management |
| WordPressService | `services/wordpressService.ts` | WordPress integration |
| TrackingService | `services/trackingService.ts` | Order tracking |
| ProfileService | `lib/profileService.ts` | User profile management |

### Import Services

```typescript
// Import from barrel export (recommended)
import { 
  ProductService, 
  OrderService, 
  LocationService 
} from '@/lib/services';

// Or import individually
import ProductService from '@/lib/services/productService';
import OrderService from '@/lib/services/orderService';
```

## 🎯 Benefits of Service Layer

### 1. **Backend Independence**

```typescript
// If backend URL changes, only update service
export const ProductService = {
  getAll: async (params) => {
    // Change endpoint here, UI doesn't need updates
    return apiClient.get('/products/v2', { params });
  }
};
```

### 2. **Easy Testing**

```typescript
// Mock entire service in tests
jest.mock('@/lib/services', () => ({
  ProductService: {
    getAll: jest.fn().mockResolvedValue({ products: [] })
  }
}));

// Test component without API calls
it('displays empty state', () => {
  render(<ProductList />);
  expect(screen.getByText('No products')).toBeInTheDocument();
});
```

### 3. **Centralized Caching**

```typescript
const LocationService = {
  // Built-in caching to reduce Google Maps API calls
  async getDeliveryEstimate(postalCode: string) {
    const cacheKey = `delivery_${postalCode}`;
    const cached = cache.get(cacheKey);
    
    if (cached && isFresh(cached)) {
      return cached.data; // Return cached data
    }
    
    const data = await apiClient.get(`/location/estimate?postalCode=${postalCode}`);
    cache.set(cacheKey, { data, timestamp: Date.now() });
    return data;
  }
};
```

### 4. **Consistent Error Handling**

```typescript
export const OrderService = {
  async createOrder(data) {
    try {
      return await apiClient.post('/orders', data);
    } catch (error) {
      // Transform error into user-friendly message
      if (error.status === 400) {
        throw new Error('Invalid order data. Please check your inputs.');
      }
      throw error;
    }
  }
};
```

### 5. **Type Safety**

```typescript
// Service methods are fully typed
interface Product {
  _id: string;
  name: string;
  price: number;
}

export const ProductService = {
  async getAll(params: ProductQuery): Promise<Product[]> {
    return apiClient.get('/products', { params });
  }
};

// Component gets full autocomplete and type checking
const products = await ProductService.getAll({ category: 'tires' });
//            ^ Product[]
```

## 🔄 Migration Strategy

### Step 1: Identify Direct apiClient Usage

```bash
# Find components using apiClient directly
grep -r "import apiClient" src/app --include="*.tsx"
```

### Step 2: Create Service Method

```typescript
// Add to existing service or create new one
export const MyService = {
  async getData(params: MyParams): Promise<MyData> {
    return apiClient.get('/my-endpoint', { params });
  }
};
```

### Step 3: Update Component

**Before:**
```typescript
import apiClient from '@/lib/api';

const data = await apiClient.get('/my-endpoint');
```

**After:**
```typescript
import { MyService } from '@/lib/services';

const data = await MyService.getData(params);
```

### Step 4: Update Tests

**Before:**
```typescript
jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: {
    get: jest.fn()
  }
}));
```

**After:**
```typescript
jest.mock('@/lib/services', () => ({
  MyService: {
    getData: jest.fn()
  }
}));
```

## 📊 Current Status

### ✅ Already Using Services
- Product pages (partially)
- Checkout flow
- Order management

### ❌ Still Using apiClient Directly
- Admin pages (returns, refunds, reviews)
- Profile page
- Cart page
- Product search page

### Priority: Migrate admin pages first (highest ROI)

## 🧪 Testing Services

### Unit Test Service

```typescript
import { ContactService } from '@/lib/services';
import apiClient from '@/lib/api';

jest.mock('@/lib/api');

describe('ContactService', () => {
  it('submits contact form', async () => {
    const mockResponse = { success: true, data: { _id: '123' } };
    (apiClient.post as jest.Mock).mockResolvedValue(mockResponse);

    const result = await ContactService.submit({
      name: 'John',
      email: 'john@example.com',
      subject: 'Test',
      message: 'Hello'
    });

    expect(result.success).toBe(true);
    expect(apiClient.post).toHaveBeenCalledWith('/contact', {
      name: 'John',
      email: 'john@example.com',
      subject: 'Test',
      message: 'Hello'
    });
  });
});
```

### Test Component with Mocked Service

```typescript
import { render, screen } from '@testing-library/react';
import { ContactPage } from './page';
import { ContactService } from '@/lib/services';

jest.mock('@/lib/services', () => ({
  ContactService: {
    submit: jest.fn()
  }
}));

it('shows success message after submission', async () => {
  (ContactService.submit as jest.Mock).mockResolvedValue({ success: true });

  render(<ContactPage />);
  
  // Fill form and submit
  // ...
  
  expect(screen.getByText('Message sent!')).toBeInTheDocument();
});
```

## 🚀 Future Enhancements

### 1. Add Interceptors

```typescript
// api-client.ts
apiClient.interceptors.request.use((config) => {
  // Add correlation ID
  config.headers['X-Correlation-ID'] = crypto.randomUUID();
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    // Add retry logic
    if (error.status === 429) {
      const retryAfter = error.headers['Retry-After'];
      await sleep(retryAfter * 1000);
      return apiClient.request(error.config);
    }
    throw error;
  }
);
```

### 2. Add Request Deduplication

```typescript
// Prevent duplicate requests
const pendingRequests = new Map<string, Promise<any>>();

export const ProductService = {
  async getAll(params) {
    const key = JSON.stringify(params);
    
    if (pendingRequests.has(key)) {
      return pendingRequests.get(key);
    }
    
    const promise = apiClient.get('/products', { params });
    pendingRequests.set(key, promise);
    
    promise.finally(() => pendingRequests.delete(key));
    return promise;
  }
};
```

### 3. Add Request Logging

```typescript
export const ProductService = {
  async getAll(params) {
    const start = performance.now();
    
    try {
      const data = await apiClient.get('/products', { params });
      
      // Log slow requests
      const duration = performance.now() - start;
      if (duration > 1000) {
        console.warn(`[SLOW] ProductService.getAll took ${duration}ms`);
      }
      
      return data;
    } catch (error) {
      // Log failures
      console.error('[ERROR] ProductService.getAll failed:', error);
      throw error;
    }
  }
};
```

## 📚 Additional Resources

- [API Client Documentation](../api-client.ts)
- [Service Layer Files](./)
- [Migration Guide](#-migration-strategy)
- [Testing Guide](#-testing-services)
