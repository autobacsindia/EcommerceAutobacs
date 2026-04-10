/**
 * Service Layer Index
 * 
 * This barrel export provides a single entry point for all services.
 * 
 * Usage:
 * ```typescript
 * import { ProductService, OrderService, ReviewService } from '@/lib/services';
 * ```
 * 
 * Architecture:
 * - Transport Layer: apiClient (handles HTTP, auth, retries)
 * - Service Layer: These services (abstract endpoints into domain methods)
 * - UI Layer: Components (call services, never apiClient directly)
 */

export { default as ProductService } from './productService';
export type { CleanProductData } from './productService';
export { default as OrderService } from './orderService';
export { 
  getReviewSummary, 
  getReviews, 
  submitReview,
  markReviewAsHelpful,
  type ReviewSubmissionData 
} from './reviewService';
export { default as LocationService } from './locationService';
export { default as ContactService } from './contactService';
export { default as ConsultationService } from './consultationService';
