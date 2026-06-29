# Enterprise Architecture - Quick Start

## ✅ What's New

All 5 enterprise improvements are now implemented and production-ready!

---

## 🚀 Quick Examples

### 1. Add Request Interceptor (Logging, Headers, etc.)

```typescript
// In your app initialization (app/providers.tsx or similar)
import apiClient from '@/lib/api';

// Add correlation ID to all requests
apiClient.addRequestInterceptor({
  onRequest: async (config) => {
    config.headers['X-Correlation-ID'] = crypto.randomUUID();
    config.headers['X-Client-Version'] = '2.0.0';
    return config;
  }
});

// Add response logging
apiClient.addResponseInterceptor({
  onResponse: async (data) => {
    if (process.env.NODE_ENV === 'development') {
      console.log('[API Response]', data);
    }
    return data;
  }
});
```

**Features Already Built-In:**
- ✅ Token injection (automatic)
- ✅ Token refresh (automatic on 401)
- ✅ Retry logic (exponential backoff)
- ✅ Rate limit handling (respects Retry-After header)
- ✅ Timeout handling (AbortController)
- ✅ Performance logging (warns on slow requests >1s)

---

### 2. Test Components with Service Mocks

**✅ CORRECT: Mock the Service**

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { ContactPage } from './page';
import { ContactService } from '@/lib/services';

// Mock service (not apiClient!)
jest.mock('@/lib/services', () => ({
  ContactService: {
    submit: jest.fn().mockResolvedValue({ success: true })
  }
}));

it('submits contact form', async () => {
  render(<ContactPage />);
  
  // Fill form
  fireEvent.change(screen.getByLabelText('Name'), {
    target: { value: 'John' }
  });
  // ... fill other fields
  
  // Submit
  fireEvent.click(screen.getByRole('button', { name: /send/i }));
  
  // Verify
  expect(ContactService.submit).toHaveBeenCalledWith({
    name: 'John',
    email: '...',
    subject: '...',
    message: '...'
  });
});
```

**❌ WRONG: Mock fetch or apiClient**

```typescript
// Don't do this - too low level!
jest.mock('fetch');
jest.mock('@/lib/api');
```

---

### 3. Use Standardized Error Handling

```typescript
import { 
  getUserFriendlyMessage,
  isRateLimitError,
  isAuthError,
  isValidationError,
  isErrorCode,
  ErrorCodes
} from '@/lib/error-handler';
import { toast } from 'react-hot-toast';

async function handleSubmit(data: any) {
  try {
    await ContactService.submit(data);
    toast.success('Message sent!');
  } catch (error) {
    // Get user-friendly message
    const message = getUserFriendlyMessage(error);
    toast.error(message);
    
    // Check specific error types
    if (isRateLimitError(error)) {
      // Disable form temporarily
      setFormDisabled(true);
    }
    
    if (isAuthError(error)) {
      // Redirect to login
      router.push('/login');
    }
    
    if (isErrorCode(error, ErrorCodes.INSUFFICIENT_STOCK)) {
      // Show stock warning
      showStockWarning();
    }
  }
}
```

---

### 4. Swap Repository Implementations (Future)

```typescript
import { createContactRepository } from '@/lib/repositories';

// Production - use real API
const repo = createContactRepository('api');

// Testing - use mock (no network calls)
const repo = createContactRepository('mock');

// Offline mode - use localStorage
const repo = createContactRepository('offline');

// Use repository
await repo.submit({
  name: 'John',
  email: 'john@example.com',
  subject: 'Test',
  message: 'Hello'
});
```

---

## 📦 Available Error Codes

```typescript
import { ErrorCodes } from '@/lib/error-handler';

ErrorCodes.UNAUTHORIZED           // 401 - Not logged in
ErrorCodes.TOKEN_EXPIRED          // 401 - Session expired
ErrorCodes.INVALID_CREDENTIALS    // 401 - Wrong password
ErrorCodes.VALIDATION_FAILED      // 400 - Invalid input
ErrorCodes.NOT_FOUND              // 404 - Resource missing
ErrorCodes.RATE_LIMITED           // 429 - Too many requests
ErrorCodes.INSUFFICIENT_STOCK     // Business - Out of stock
ErrorCodes.ORDER_CANNOT_BE_CANCELLED // Business - Can't cancel
ErrorCodes.TIMEOUT                // 504 - Request timeout
ErrorCodes.SERVICE_UNAVAILABLE    // 503 - Server down
```

---

## 🧪 Testing Patterns

### Test Service

```typescript
// services/contactService.test.ts
import { ContactService } from './contactService';
import apiClient from '@/lib/api';

jest.mock('@/lib/api');

describe('ContactService', () => {
  it('submits form', async () => {
    (apiClient.post as jest.Mock).mockResolvedValue({
      success: true,
      data: { _id: '123' }
    });

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

### Test Component

```typescript
// app/contact/page.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ContactPage from './page';
import { ContactService } from '@/lib/services';

jest.mock('@/lib/services', () => ({
  ContactService: {
    submit: jest.fn()
  }
}));

it('shows success message', async () => {
  (ContactService.submit as jest.Mock).mockResolvedValue({ success: true });

  render(<ContactPage />);
  
  // Fill and submit form
  fireEvent.click(screen.getByRole('button', { name: /send/i }));
  
  await waitFor(() => {
    expect(screen.getByText(/thank you/i)).toBeInTheDocument();
  });
});
```

---

## 📁 File Structure

```
src/lib/
├── api-client.ts              ← Transport layer (enhanced with interceptors)
├── api-types.ts               ← Standardized error types
├── error-handler.ts           ← Error utilities (NEW)
├── repositories.ts            ← Repository interfaces (NEW)
└── services/
    ├── index.ts               ← Barrel export
    ├── contactService.ts      ← Contact form service (NEW)
    ├── consultationService.ts ← Consultation service (NEW)
    ├── locationService.ts     ← Location service (NEW, with caching)
    ├── productService.ts      ← Product service
    ├── orderService.ts        ← Order service
    ├── reviewService.ts       ← Review service
    └── contactService.test.ts ← Service test example (NEW)
```

---

## 🎯 Benefits Summary

| Feature | Before | After |
|---------|--------|-------|
| **Request Logging** | ❌ Manual console.log | ✅ Automatic with timing |
| **Error Handling** | ❌ Inconsistent | ✅ Standardized shape |
| **Testing** | ❌ Mock fetch/apiClient | ✅ Mock services |
| **Offline Mode** | ❌ Not possible | ✅ Repository pattern ready |
| **Token Refresh** | ✅ Built-in | ✅ Built-in |
| **Retry Logic** | ✅ Built-in | ✅ Built-in |
| **Type Safety** | ⚠️ Partial | ✅ Full TypeScript |

---

## 📚 Documentation

| Document | Purpose |
|----------|---------|
| [ENTERPRISE_ARCHITECTURE_IMPROVEMENTS.md](../ENTERPRISE_ARCHITECTURE_IMPROVEMENTS.md) | Complete guide to all 5 improvements |
| [SERVICE_LAYER_ARCHITECTURE.md](src/lib/services/SERVICE_LAYER_ARCHITECTURE.md) | Service layer documentation |
| [QUICK_REFERENCE.md](src/lib/services/QUICK_REFERENCE.md) | Quick usage examples |
| [FRONTEND_BACKEND_DECOUPLING.md](../FRONTEND_BACKEND_DECOUPLING.md) | Migration guide |

---

## ✅ Checklist

- [x] Request interceptors implemented
- [x] Response interceptors implemented
- [x] Performance logging added
- [x] Service test example created
- [x] Repository interfaces defined
- [x] Error standardization complete
- [x] Error helper utilities created
- [x] TypeScript compilation passes
- [x] Documentation complete

---

**Ready to use!** 🎉

All improvements are production-ready and backward compatible. No breaking changes to existing code.
