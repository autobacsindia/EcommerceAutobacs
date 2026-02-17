
import {
  getReviewSummary,
  getReviews,
  submitReview,
  markReviewAsHelpful,
} from './reviewService';
import apiClient from '@/lib/api';

// Mock API Client
jest.mock('@/lib/api', () => ({
  get: jest.fn(),
  post: jest.fn(),
}));

describe('ReviewService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getReviewSummary', () => {
    it('fetches review summary successfully', async () => {
      const mockSummary = {
        averageRating: 4.5,
        totalReviews: 10,
        ratingDistribution: { 5: 5, 4: 5 },
      };
      (apiClient.get as jest.Mock).mockResolvedValue({ summary: mockSummary });

      const result = await getReviewSummary('p1');

      expect(apiClient.get).toHaveBeenCalledWith('/reviews/products/p1/summary');
      expect(result).toEqual(mockSummary);
    });

    it('handles errors', async () => {
      (apiClient.get as jest.Mock).mockRejectedValue(new Error('API Error'));
      await expect(getReviewSummary('p1')).rejects.toThrow('API Error');
    });
  });

  describe('getReviews', () => {
    it('fetches and transforms reviews successfully', async () => {
      const mockReviews = [
        {
          id: 'r1',
          user: { id: 'u1', name: 'User 1' },
          rating: 5,
          title: 'Great',
          comment: 'Loved it',
          createdAt: '2023-01-01',
          helpfulCount: 2,
        },
      ];
      const mockResponse = {
        reviews: mockReviews,
        pagination: {
          currentPage: 1,
          totalPages: 1,
          totalReviews: 1,
          hasNext: false,
          hasPrev: false,
        },
      };

      (apiClient.get as jest.Mock).mockResolvedValue(mockResponse);

      const result = await getReviews('p1');

      expect(apiClient.get).toHaveBeenCalledWith(expect.stringContaining('/reviews/products/p1'));
      expect(result.reviews).toHaveLength(1);
      expect(result.reviews[0].id).toBe('r1');
      expect(result.reviews[0].isApproved).toBe(true);
    });
  });

  describe('submitReview', () => {
    it('submits review successfully', async () => {
      const reviewData = {
        rating: 5,
        comment: 'Great!',
        title: 'Awesome',
      };
      const mockResponse = { success: true, message: 'Review submitted', review: { id: 'r2' } };
      (apiClient.post as jest.Mock).mockResolvedValue(mockResponse);

      const result = await submitReview('p1', reviewData);

      expect(apiClient.post).toHaveBeenCalledWith('/reviews/products/p1', reviewData);
      expect(result.success).toBe(true);
    });
  });

  describe('markReviewAsHelpful', () => {
    it('marks review as helpful', async () => {
      const mockResponse = { success: true, helpfulCount: 5 };
      (apiClient.post as jest.Mock).mockResolvedValue(mockResponse);

      const result = await markReviewAsHelpful('r1');

      expect(apiClient.post).toHaveBeenCalledWith('/reviews/r1/helpful', {});
      expect(result.helpfulCount).toBe(5);
    });
  });
});
