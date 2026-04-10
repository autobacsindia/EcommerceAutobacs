# Service Layer Quick Reference

## 📦 Import Services

```typescript
// Import all services from barrel export
import { 
  ProductService, 
  OrderService, 
  ReviewService,
  LocationService,
  ContactService,
  ConsultationService
} from '@/lib/services';
```

## 🎯 Usage Examples

### Products
```typescript
const { products, pagination } = await ProductService.fetchProductsFromAPI({
  page: 1,
  limit: 20,
  category: 'tires'
});

const product = await ProductService.fetchProductFromAPI('product-id');

const brands = await ProductService.getBrands(50);
```

### Orders
```typescript
const order = await OrderService.getOrder(orderId);
const orders = await OrderService.getUserOrders({ page: 1, limit: 10 });
```

### Reviews
```typescript
const reviews = await ReviewService.getProductReviews(productId, { page: 1 });
await ReviewService.createReview(productId, { rating: 5, comment: 'Great!' });
```

### Location (with caching)
```typescript
// Automatically cached for 5 minutes
const location = await LocationService.getCurrentLocation();
const estimate = await LocationService.getDeliveryEstimate('400001');
await LocationService.selectLocation({ lat: 19.076, lng: 72.8777 });
```

### Contact
```typescript
await ContactService.submit({
  name: 'John',
  email: 'john@example.com',
  subject: 'Question',
  message: 'Hello!'
});

const messages = await ContactService.getAllMessages({ status: 'new', page: 1 });
```

### Consultation
```typescript
await ConsultationService.book({
  name: 'John',
  whatsapp: '+919876543210',
  city: 'Mumbai',
  makeModel: 'Honda City',
  mode: 'Video Call'
});

const consultations = await ConsultationService.getAll({ status: 'new' });
```

## 🧪 Testing

```typescript
// Mock services in tests
jest.mock('@/lib/services', () => ({
  ProductService: {
    fetchProductsFromAPI: jest.fn().mockResolvedValue({ products: [] })
  },
  ContactService: {
    submit: jest.fn().mockResolvedValue({ success: true })
  }
}));
```

## ❌ Don't Do This

```typescript
// WRONG: Don't use apiClient directly in components
import apiClient from '@/lib/api';

const products = await apiClient.get('/products'); // ❌
await apiClient.post('/contact', data); // ❌
```

## ✅ Do This

```typescript
// CORRECT: Use service layer
import { ProductService, ContactService } from '@/lib/services';

const products = await ProductService.fetchProductsFromAPI(); // ✅
await ContactService.submit(data); // ✅
```

## 📁 File Locations

```
src/lib/services/
├── index.ts                    ← Barrel export (import from here)
├── productService.ts           ← Products, brands, search
├── orderService.ts             ← Orders, checkout
├── reviewService.ts            ← Reviews, ratings
├── locationService.ts          ← Location, delivery estimates (cached)
├── contactService.ts           ← Contact form
├── consultationService.ts      ← Consultation bookings
└── SERVICE_LAYER_ARCHITECTURE.md ← Full documentation
```

## 🔄 Migration Pattern

1. Find `apiClient` usage in component
2. Import service: `import { XService } from '@/lib/services';`
3. Replace API call with service method
4. Update test mocks

**Before:**
```typescript
import apiClient from '@/lib/api';
await apiClient.post('/contact', formData);
```

**After:**
```typescript
import { ContactService } from '@/lib/services';
await ContactService.submit(formData);
```

---

**Full Documentation:** [SERVICE_LAYER_ARCHITECTURE.md](./SERVICE_LAYER_ARCHITECTURE.md)
