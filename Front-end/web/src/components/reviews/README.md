# Reviews Components

This directory contains all the React components for implementing product reviews and ratings functionality.

## Component Structure

### 1. StarRating (`StarRating.tsx`)
A reusable component for displaying and selecting star ratings.

**Props:**
- `rating`: Current rating value (0-5)
- `interactive`: Whether the rating is selectable (default: false)
- `onRatingChange`: Callback when rating is changed (for interactive mode)
- `size`: Size of stars ('small', 'medium', 'large')

### 2. ReviewForm (`ReviewForm.tsx`)
A form component for submitting new product reviews.

**Props:**
- `productId`: ID of the product being reviewed
- `onSubmit`: Callback function to handle form submission
- `onCancel`: Optional callback for canceling the form

### 3. ReviewSummary (`ReviewSummary.tsx`)
Displays the overall rating statistics for a product.

**Props:**
- `averageRating`: Average rating value
- `totalReviews`: Total number of reviews
- `ratingDistribution`: Distribution of ratings (1-5 stars)

### 4. ReviewItem (`ReviewItem.tsx`)
Displays a single product review with all its details.

**Props:**
- `id`: Review ID
- `user`: User information (id, name)
- `rating`: Rating value (1-5)
- `title`: Review title (optional)
- `comment`: Review text
- `images`: Array of review images (optional)
- `isVerifiedPurchase`: Whether the reviewer purchased the product
- `helpfulCount`: Number of times the review was marked helpful
- `createdAt`: Review creation date
- `onHelpful`: Callback when "Helpful" button is clicked

### 5. ReviewList (`ReviewList.tsx`)
Displays a list of reviews with sorting capabilities.

**Props:**
- `reviews`: Array of review objects
- `onHelpful`: Callback when a review is marked helpful
- `totalReviews`: Total number of reviews for the product

### 6. Reviews (`Reviews.tsx`)
Main component that combines all review functionality.

**Props:**
- `productId`: ID of the product
- `isAuthenticated`: Whether the user is logged in

## Services

### reviewService (`reviewService.ts`)
Handles all API interactions for reviews:
- `getReviewSummary`: Fetches rating summary for a product
- `getReviews`: Fetches paginated reviews for a product
- `submitReview`: Submits a new review
- `markReviewAsHelpful`: Marks a review as helpful

## Usage Example

```tsx
import Reviews from '../components/reviews/Reviews';

// In your product page component
<Reviews 
  productId="product-id-here" 
  isAuthenticated={userIsLoggedIn} 
/>
```

## Styling

Each component has its own CSS module for scoped styling:
- `StarRating.module.css`
- `ReviewForm.module.css`
- `ReviewSummary.module.css`
- `ReviewItem.module.css`
- `ReviewList.module.css`
- `Reviews.module.css`

## Dependencies

These components require:
- React (v17+)
- CSS modules support