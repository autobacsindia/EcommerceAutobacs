// Review service to handle API calls for reviews
import { Product, Review, ReviewSummary, PaginatedReviews } from '../types';
import apiClient from '../api';

export interface ReviewSubmissionData {
  rating: number;
  title?: string;
  comment: string;
  images?: { url: string; alt: string }[];
}

export const getReviewSummary = async (productId: string): Promise<ReviewSummary> => {
  try {
    const response = await apiClient.get(`/reviews/products/${productId}/summary`);
    return (response as any).summary;
  } catch (error) {
    if (process.env.NODE_ENV !== 'test') {
      console.error('Error fetching review summary:', error);
    }
    throw error;
  }
};

export const getReviews = async (
  productId: string,
  page: number = 1,
  limit: number = 10,
  sortBy: string = 'createdAt',
  order: string = 'desc'
): Promise<PaginatedReviews> => {
  try {
    const params = new URLSearchParams({
      page: page.toString(),
      limit: limit.toString(),
      sortBy,
      order
    });
    
    const apiResponse = await apiClient.get(`/reviews/products/${productId}?${params.toString()}`) as any;
    
    // Transform the response to match our frontend types
    const transformedReviews: Review[] = apiResponse.reviews.map((review: any) => ({
      id: review.id,
      user: {
        id: review.user.id,
        name: review.user.name
      },
      rating: review.rating,
      title: review.title,
      comment: review.comment,
      images: review.images || [],
      isVerifiedPurchase: review.isVerifiedPurchase || false,
      helpfulCount: review.helpfulCount || 0,
      isApproved: true, // Since these are approved reviews
      createdAt: review.createdAt
    }));
    
    return {
      reviews: transformedReviews,
      pagination: {
        currentPage: apiResponse.pagination.currentPage,
        totalPages: apiResponse.pagination.totalPages,
        totalReviews: apiResponse.pagination.totalReviews,
        hasNext: apiResponse.pagination.hasNext,
        hasPrev: apiResponse.pagination.hasPrev
      }
    };
  } catch (error) {
    if (process.env.NODE_ENV !== 'test') {
      console.error('Error fetching reviews:', error);
    }
    throw error;
  }
};

export const submitReview = async (
  productId: string,
  reviewData: ReviewSubmissionData
): Promise<{ success: boolean; message: string; review?: any }> => {
  try {
    const response = await apiClient.post(`/reviews/products/${productId}`, reviewData) as any;
    return {
      success: response.success,
      message: response.message,
      review: response.review
    };
  } catch (error) {
    if (process.env.NODE_ENV !== 'test') {
      console.error('Error submitting review:', error);
    }
    throw error;
  }
};

export const markReviewAsHelpful = async (
  reviewId: string
): Promise<{ success: boolean; helpfulCount: number }> => {
  try {
    const response = await apiClient.post<any>(`/reviews/${reviewId}/helpful`, {});
    return {
      success: response.success,
      helpfulCount: response.helpfulCount
    };
  } catch (error) {
    if (process.env.NODE_ENV !== 'test') {
      console.error('Error marking review as helpful:', error);
    }
    throw error;
  }
};