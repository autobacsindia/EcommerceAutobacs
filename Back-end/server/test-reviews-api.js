/*
 * Test script for Reviews API
 * This script demonstrates how to use the reviews API endpoints
 */

// Example usage of the Reviews API

console.log("=== Reviews API Usage Examples ===\n");

// 1. Get product reviews (public endpoint)
console.log("1. GET /reviews/products/:productId");
console.log("   Purpose: Get all approved reviews for a product");
console.log("   Usage:");
console.log("   fetch('/api/reviews/products/5f9d3b3b3b3b3b3b3b3b3b3b')");
console.log("   fetch('/api/reviews/products/5f9d3b3b3b3b3b3b3b3b3b3b?page=2&limit=5')");
console.log("   fetch('/api/reviews/products/5f9d3b3b3b3b3b3b3b3b3b3b?minRating=4&sortBy=rating&order=desc')\n");

// 2. Get product review summary (public endpoint)
console.log("2. GET /reviews/products/:productId/summary");
console.log("   Purpose: Get review summary statistics for a product");
console.log("   Usage:");
console.log("   fetch('/api/reviews/products/5f9d3b3b3b3b3b3b3b3b3b3b/summary')\n");

// 3. Submit a review (authenticated user)
console.log("3. POST /reviews/products/:productId");
console.log("   Purpose: Submit a new review for a product");
console.log("   Usage:");
console.log("   fetch('/api/reviews/products/5f9d3b3b3b3b3b3b3b3b3b3b', {");
console.log("     method: 'POST',");
console.log("     headers: {");
console.log("       'Content-Type': 'application/json',");
console.log("       'Authorization': 'Bearer <jwt_token>'");
console.log("     },");
console.log("     body: JSON.stringify({");
console.log("       rating: 5,");
console.log("       title: 'Excellent product!',");
console.log("       comment: 'This product exceeded my expectations. Great quality and fast delivery.',");
console.log("       images: [");
console.log("         { url: 'https://example.com/image1.jpg', alt: 'Product image 1' },");
console.log("         { url: 'https://example.com/image2.jpg', alt: 'Product image 2' }");
console.log("       ]");
console.log("     })");
console.log("   })\n");

// 4. Update own review (authenticated user)
console.log("4. PUT /reviews/:reviewId");
console.log("   Purpose: Update your own review");
console.log("   Usage:");
console.log("   fetch('/api/reviews/5f9d3b3b3b3b3b3b3b3b3b3b', {");
console.log("     method: 'PUT',");
console.log("     headers: {");
console.log("       'Content-Type': 'application/json',");
console.log("       'Authorization': 'Bearer <jwt_token>'");
console.log("     },");
console.log("     body: JSON.stringify({");
console.log("       rating: 4,");
console.log("       title: 'Good product with some minor issues',");
console.log("       comment: 'Updated review after extended use. Still satisfied overall.'");
console.log("     })");
console.log("   })\n");

// 5. Delete own review (authenticated user)
console.log("5. DELETE /reviews/:reviewId");
console.log("   Purpose: Delete your own review");
console.log("   Usage:");
console.log("   fetch('/api/reviews/5f9d3b3b3b3b3b3b3b3b3b3b', {");
console.log("     method: 'DELETE',");
console.log("     headers: {");
console.log("       'Authorization': 'Bearer <jwt_token>'");
console.log("     }");
console.log("   })\n");

// 6. Mark review as helpful (authenticated user)
console.log("6. POST /reviews/:reviewId/helpful");
console.log("   Purpose: Mark a review as helpful");
console.log("   Usage:");
console.log("   fetch('/api/reviews/5f9d3b3b3b3b3b3b3b3b3b3b/helpful', {");
console.log("     method: 'POST',");
console.log("     headers: {");
console.log("       'Authorization': 'Bearer <jwt_token>'");
console.log("     }");
console.log("   })\n");

// 7. Get all reviews (admin)
console.log("7. GET /reviews/admin");
console.log("   Purpose: Get all reviews (admin only)");
console.log("   Usage:");
console.log("   fetch('/api/reviews/admin?status=pending&page=1&limit=10', {");
console.log("     headers: {");
console.log("       'Authorization': 'Bearer <admin_jwt_token>'");
console.log("     }");
console.log("   })\n");

// 8. Approve review (admin)
console.log("8. PUT /reviews/:reviewId/approve");
console.log("   Purpose: Approve a review (admin only)");
console.log("   Usage:");
console.log("   fetch('/api/reviews/5f9d3b3b3b3b3b3b3b3b3b3b/approve', {");
console.log("     method: 'PUT',");
console.log("     headers: {");
console.log("       'Authorization': 'Bearer <admin_jwt_token>'");
console.log("     }");
console.log("   })\n");

// 9. Reject review (admin)
console.log("9. PUT /reviews/:reviewId/reject");
console.log("   Purpose: Reject a review (admin only)");
console.log("   Usage:");
console.log("   fetch('/api/reviews/5f9d3b3b3b3b3b3b3b3b3b3b/reject', {");
console.log("     method: 'PUT',");
console.log("     headers: {");
console.log("       'Authorization': 'Bearer <admin_jwt_token>'");
console.log("     }");
console.log("   })\n");

// 10. Delete any review (admin)
console.log("10. DELETE /reviews/:reviewId/admin");
console.log("    Purpose: Delete any review (admin only)");
console.log("    Usage:");
console.log("    fetch('/api/reviews/5f9d3b3b3b3b3b3b3b3b3b3b/admin', {");
console.log("      method: 'DELETE',");
console.log("      headers: {");
console.log("        'Authorization': 'Bearer <admin_jwt_token>'");
console.log("      }");
console.log("    })\n");

console.log("=== End of Examples ===");