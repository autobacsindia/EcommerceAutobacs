# Autobacs India Frontend

## Project Overview

Modern e-commerce frontend for Autobacs India, built with Next.js 14, React, and TypeScript.

## Features

### Core Functionality
- **User Authentication:** Secure login/register with JWT
- **Product Catalog:** Browse and search thousands of automotive products
- **Shopping Cart:** Add/remove items, adjust quantities
- **Wishlist:** Save favorite products for later
- **Checkout Process:** Secure order placement with multiple payment options
- **Order History:** Track past purchases and order status
- **User Profile:** Manage account details and preferences

### UI/UX Features
- **Responsive Design:** Mobile-first approach with Tailwind CSS
- **Product Filtering:** Advanced search and filtering options
- **Product Comparison:** Compare similar products side-by-side
- **Image Gallery:** High-quality product images with zoom functionality
- **Customer Reviews:** Read and submit product reviews
- **Real-time Updates:** Live inventory and pricing information

### Technical Features
- **TypeScript:** Strong typing for improved code quality
- **Next.js App Router:** Modern routing with server components
- **API Integration:** RESTful API consumption with error handling
- **State Management:** Context API for global state
- **Performance Optimizations:** Image optimization, code splitting
- **SEO Friendly:** Metadata and structured data implementation

## Project Structure

```
src/
├── app/                 # Next.js app router pages
│   ├── admin/          # Admin dashboard pages
│   ├── api/            # API route handlers
│   ├── auth/           # Authentication pages
│   ├── cart/           # Shopping cart page
│   ├── categories/     # Product categories pages
│   ├── checkout/       # Checkout flow pages
│   ├── orders/         # Order history pages
│   ├── products/       # Product listing and detail pages
│   ├── profile/        # User profile pages
│   ├── search/         # Search results pages
│   └── wishlist/       # Wishlist page
├── components/         # Reusable UI components
│   ├── categories/     # Category-related components
│   ├── layout/         # Layout components (header, footer, etc.)
│   ├── products/       # Product-related components
│   └── ui/             # Generic UI components
├── context/            # React context providers
├── hooks/              # Custom React hooks
├── lib/                # Utility functions and helpers
│   ├── api/            # API client and utilities
│   └── types/          # TypeScript type definitions
└── styles/             # Global styles and Tailwind config
```

## Getting Started

### Prerequisites
- Node.js 18+ installed
- npm or yarn package manager

### Installation
1. Navigate to the frontend directory:
   ```bash
   cd "C:\Main project\Autobacs\Front-end\web"
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

### Development
Start the development server:
```bash
npm run dev
```

The application will be available at `http://localhost:3000`.

### Production Build
Create an optimized production build:
```bash
npm run build
```

Start the production server:
```bash
npm start
```

## Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Create production build
- `npm start` - Start production server
- `npm run lint` - Run ESLint
- `npm run type-check` - Run TypeScript type checking

## API Integration

The frontend communicates with the backend API at `http://localhost:5000`.

### API Endpoints

#### Authentication (`/auth`)
- `POST /auth/register` - Register new user
- `POST /auth/login` - Login user
- `GET /auth/profile` - Get authenticated user profile
- `PUT /auth/profile` - Update user profile

#### Products (`/products`)
- `GET /products` - List products with filtering/pagination
- `GET /products/:id` - Get product by ID
- `GET /products/featured` - Get featured products
- `GET /products/search-suggestions` - Get search suggestions

#### Categories (`/categories`)
- `GET /categories` - List categories
- `GET /categories/:id` - Get category by ID
- `GET /categories/:slug` - Get category by slug
- `GET /categories/hierarchical` - Get hierarchical category tree

#### Cart (`/cart`)
- `GET /cart` - Get user's cart
- `POST /cart/add` - Add item to cart
- `PUT /cart/update` - Update cart item quantity
- `DELETE /cart/remove` - Remove item from cart
- `DELETE /cart/clear` - Clear entire cart

#### Wishlist (`/wishlist`)
- `GET /wishlist` - Get user's wishlist
- `POST /wishlist/add` - Add item to wishlist
- `DELETE /wishlist/remove` - Remove item from wishlist
- `DELETE /wishlist/clear` - Clear entire wishlist

## Environment Variables

Create a `.env.local` file in the root directory with the following variables:

```
NEXT_PUBLIC_API_URL=http://localhost:5000
NEXT_PUBLIC_APP_NAME=Autobacs India
```

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a pull request

## License

This project is proprietary and confidential. All rights reserved.