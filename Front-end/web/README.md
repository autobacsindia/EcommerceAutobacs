# Autobacs India - Next.js Frontend

Modern Next.js 16 application for the Autobacs India automotive e-commerce platform, built with TypeScript, Tailwind CSS, and the App Router.

## Tech Stack

- **Framework:** Next.js 16.0.3 (App Router)
- **UI Library:** React 19.2.0
- **Language:** TypeScript 5
- **Styling:** Tailwind CSS 4.1
- **Icons:** Lucide React, React Icons
- **Forms:** React Hook Form + Zod validation
- **State Management:** React Context API
- **HTTP Client:** Native Fetch API

## Project Structure

```
src/
├── app/                      # Next.js App Router pages
│   ├── layout.tsx           # Root layout with providers
│   ├── page.tsx             # Home page
│   └── globals.css          # Global styles
├── components/
│   └── layout/
│       ├── Header.tsx       # Header component
│       └── Footer.tsx       # Footer component
├── context/
│   ├── AuthContext.tsx      # Authentication state
│   └── CartContext.tsx      # Shopping cart state
└── lib/
    ├── api.ts               # API client
    ├── utils.ts             # Utility functions
    └── constants.ts         # App constants
```

## Getting Started

### Prerequisites

- Node.js 20+ recommended
- Backend API running on http://localhost:5000

### Installation

```bash
# Install dependencies
npm install
```

### Environment Variables

Create a `.env.local` file:

```env
NEXT_PUBLIC_API_URL=http://localhost:5000
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### Development

```bash
# Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Build for Production

```bash
npm run build
npm start
```

## Features Implemented

### ✅ Phase 1 & 2 Complete

- [x] Next.js 16 setup with App Router
- [x] TypeScript configuration
- [x] Tailwind CSS 4.1 styling
- [x] API client with JWT authentication
- [x] Authentication context (login, register, logout)
- [x] Shopping cart context
- [x] Responsive header with cart count
- [x] Professional footer
- [x] Home page with hero and features

### 🔄 In Development

- [ ] Login/Register pages
- [ ] Product catalog
- [ ] Product detail pages
- [ ] Shopping cart page
- [ ] Checkout flow
- [ ] User dashboard
- [ ] Admin panel

## API Integration

### Backend Connection

The app connects to the Express backend at `http://localhost:5000`.

### API Endpoints

All endpoints are defined in `src/lib/constants.ts`:

- **Auth:** `/auth/login`, `/auth/register`, `/auth/me`
- **Products:** `/products`, `/products/:id`
- **Cart:** `/cart`, `/cart/add`, `/cart/update/:id`
- **Orders:** `/orders`, `/orders/:id`
- **Categories:** `/categories`, `/categories/:id`
- **Vehicles:** `/vehicles`, `/vehicles/:id`

### Authentication Flow

1. User logs in via login page
2. Backend returns JWT token
3. Token stored in localStorage
4. Token attached to all API requests
5. AuthContext manages user state

## Development Guidelines

### Adding New Pages

```tsx
// app/new-page/page.tsx
export default function NewPage() {
  return <div>Content</div>;
}
```

### Using API Client

```tsx
import { apiClient } from '@/lib/api';

// GET request
const products = await apiClient.get('/products');

// POST request with auth
const order = await apiClient.post('/orders', { items: [...] });
```

### Using Auth Context

```tsx
'use client';

import { useAuth } from '@/context/AuthContext';

export default function Component() {
  const { user, login, logout, isAuthenticated } = useAuth();
  
  // Use authentication state
}
```

### Using Cart Context

```tsx
'use client';

import { useCart } from '@/context/CartContext';

export default function Component() {
  const { cart, itemCount, addToCart } = useCart();
  
  // Use cart operations
}
```

## Utility Functions

Located in `src/lib/utils.ts`:

- `formatCurrency(amount)` - Format price in INR
- `formatDate(date)` - Format date strings
- `truncateText(text, length)` - Truncate long text
- `debounce(func, wait)` - Debounce function calls
- `cn(...)` - Merge Tailwind classes

## Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm start` - Start production server
- `npm run lint` - Run ESLint

## Browser Support

- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)

## Contributing

This is the frontend for Autobacs India e-commerce platform. The backend API is located in `../../Back-end/server/`.

## Migration Notes

This Next.js app replaces the previous Create React App. The old app is preserved in `../client/` as backup.

**Key Improvements:**
- Server-side rendering for SEO
- Better performance with automatic code splitting
- Modern React 19 features
- TypeScript for type safety
- Improved developer experience

## Troubleshooting

### Port Already in Use
```bash
# Kill process on port 3000
npx kill-port 3000
```

### Clear Cache
```bash
rm -rf .next
npm run dev
```

### Module Not Found
```bash
rm -rf node_modules
npm install
```

## License

Copyright © 2025 Autobacs India. All rights reserved.
