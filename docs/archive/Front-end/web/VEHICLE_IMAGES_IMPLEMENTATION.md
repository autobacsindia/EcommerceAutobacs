# Vehicle Images Implementation

## Overview
This document explains how vehicle images are implemented in the vehicles page to match the Autobacs India website.

## Implementation Details

### 1. Image Storage
Vehicle images are stored in:
```
/public/images/vehicles/
```

Each vehicle has two image files:
- `{vehicle-slug}.jpg` - Primary image file
- `{vehicle-slug}.svg` - Fallback vector image

### 2. Vehicle Data Structure
The vehicles array now includes an `image` property:
```typescript
const vehicles = [
  { 
    id: 1, 
    name: 'Toyota Hilux', 
    slug: 'toyota-hilux', 
    image: '/images/vehicles/toyota-hilux.jpg' 
  },
  // ... other vehicles
];
```

### 3. Image Display Component
The vehicle card component displays images with the following features:
- Responsive image sizing with `object-cover`
- Hover zoom effect with `group-hover:scale-110`
- Fallback mechanism for missing images
- Overlay text on hover for better UX
- Persistent text at the bottom for identification

### 4. Error Handling
Images have a robust error handling system:
1. If the primary JPG image fails to load, it attempts to load the SVG version
2. If both fail, it falls back to a generic product placeholder image

### 5. Placeholder Generation
A Node.js script (`generate-vehicle-images.js`) creates placeholder images for all vehicles:
- Generates SVG placeholders with vehicle names
- Creates both SVG and JPG versions (JPG is a copy of SVG)
- Can be replaced with actual images from the live site

## How to Replace Placeholders with Actual Images

1. Download actual vehicle images from https://autobacsindia.com/vehicles/
2. Save each image with the correct filename format:
   - Use the vehicle slug as the filename
   - Save as JPG format in `/public/images/vehicles/`
3. Ensure images are properly sized (recommended: 400x300px)

## File Structure
```
/public/
  └── images/
      ├── fallback-product.png
      └── vehicles/
          ├── toyota-hilux.jpg
          ├── toyota-hilux.svg
          ├── mahindra-thar.jpg
          ├── mahindra-thar.svg
          └── ... (one JPG and one SVG for each vehicle)
```

## CSS Classes Used
- `object-cover`: Ensures images cover the container without distortion
- `transition-transform`: Smooth scaling animation
- `group-hover:scale-110`: Zoom effect on hover
- `opacity-0` / `group-hover:opacity-100`: Overlay visibility on hover
- Responsive grid classes for different screen sizes

## Future Improvements
1. Implement actual high-quality images from the live site
2. Add lazy loading for better performance
3. Implement image optimization (WebP format, compression)
4. Add alt text optimization for SEO
5. Consider using a CDN for image delivery