# Layout Components

## EnhancedImage Component

The [EnhancedImage] component is a wrapper around Next.js's Image component that provides enhanced validation and fallback handling for image sources.

### Features

1. **Validation**: Checks if image sources are valid before rendering
2. **Fallback Handling**: Provides appropriate fallback images for different contexts
3. **Error Handling**: Gracefully handles image loading errors
4. **Type Safety**: Proper TypeScript typing for all props

### Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| src | string \| null \| undefined | Yes | The image source URL |
| alt | string | Yes | Alternative text for the image |
| width | number | No | Image width |
| height | number | No | Image height |
| priority | boolean | No | Whether to preload the image |
| className | string | No | CSS classes to apply to the image |
| fallbackSrc | string | No | Explicit fallback image URL |
| context | 'product' \| 'category' \| 'profile' \| 'generic' | No | Context for selecting appropriate fallback |

### Usage

```tsx
import EnhancedImage from '@/components/layout/EnhancedImage';

// Basic usage
<EnhancedImage
  src={product.image}
  alt={product.name}
  width={200}
  height={200}
  context="product"
/>

// With explicit fallback
<EnhancedImage
  src={user.avatar}
  alt={user.name}
  fallbackSrc="/images/default-avatar.png"
  context="profile"
/>
```

### Fallback Images

The component automatically selects appropriate fallback images based on context:

- `product`: /images/fallback-product.png
- `category`: /images/fallback-category.png
- `profile`: /images/fallback-profile.png
- `generic`: /images/fallback-generic.png

If a specific fallback image is not available, it will display a text-based fallback.

## Pagination Component

The [Pagination] component provides a clean, accessible pagination interface with previous/next buttons and smart page numbering.

### Features

1. **Previous/Next Navigation**: Clear navigation buttons
2. **Smart Page Display**: Shows relevant pages with ellipses for large page sets
3. **Current Page Highlighting**: Clearly indicates the current page
4. **Accessibility**: Proper ARIA attributes and keyboard navigation
5. **Responsive Design**: Works well on all screen sizes

### Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| pagination | Pagination object | Yes | Pagination data from API |
| currentPage | number | Yes | Current page number |
| basePath | string | Yes | Base path for pagination links |
| searchParams | URLSearchParams | No | Current search parameters to preserve |

### Usage

```tsx
import Pagination from '@/components/layout/Pagination';

<Pagination
  pagination={data.pagination}
  currentPage={currentPage}
  basePath="/products"
  searchParams={searchParams}
/>
```

### Smart Page Display

For large page sets, the component intelligently displays:

- First page
- Pages around the current page (within delta of 2)
- Last page
- Ellipses (...) where appropriate

Example for 10 pages when on page 5:
```
1 ... 3 4 5 6 7 ... 10
```