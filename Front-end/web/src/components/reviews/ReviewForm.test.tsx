import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ReviewForm from './ReviewForm';

// Mock StarRating component
jest.mock('./StarRating', () => {
  return function MockStarRating({ rating, onRatingChange }: { rating: number; onRatingChange: (r: number) => void }) {
    return (
      <div data-testid="star-rating">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            onClick={() => onRatingChange(star)}
            aria-label={`Rate ${star} stars`}
            data-testid={`star-${star}`}
          >
            {star} Star
          </button>
        ))}
        <span data-testid="current-rating">{rating}</span>
      </div>
    );
  };
});

describe('ReviewForm Component', () => {
  const mockOnSubmit = jest.fn();
  const mockOnCancel = jest.fn();
  const defaultProps = {
    productId: 'p123',
    onSubmit: mockOnSubmit,
    onCancel: mockOnCancel,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders correctly', () => {
    render(<ReviewForm {...defaultProps} />);
    expect(screen.getByRole('heading', { name: /Write a Review/i })).toBeInTheDocument();
    expect(screen.getByTestId('star-rating')).toBeInTheDocument();
    expect(screen.getByLabelText(/Title/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Comment \*/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Submit Review/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cancel/i })).toBeInTheDocument();
  });

  it('validates required fields', async () => {
    render(<ReviewForm {...defaultProps} />);
    
    const submitBtn = screen.getByRole('button', { name: /Submit Review/i });
    fireEvent.click(submitBtn);

    expect(await screen.findByText(/Please select a rating/i)).toBeInTheDocument();
    expect(await screen.findByText(/Comment is required/i)).toBeInTheDocument();
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('submits valid data', async () => {
    render(<ReviewForm {...defaultProps} />);
    
    // Select Rating (5 stars)
    fireEvent.click(screen.getByTestId('star-5'));
    
    // Fill Title
    const titleInput = screen.getByLabelText(/Title/i);
    fireEvent.change(titleInput, { target: { value: 'Great Product' } });
    
    // Fill Comment
    const commentInput = screen.getByLabelText(/Comment \*/i);
    fireEvent.change(commentInput, { target: { value: 'This is a fantastic product! I love it.' } });
    
    // Submit
    const submitBtn = screen.getByRole('button', { name: /Submit Review/i });
    fireEvent.click(submitBtn);
    
    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledWith({
        rating: 5,
        title: 'Great Product',
        comment: 'This is a fantastic product! I love it.',
        images: [],
      });
    });
  });

  it('validates comment length', async () => {
    render(<ReviewForm {...defaultProps} />);
    
    // Select Rating
    fireEvent.click(screen.getByTestId('star-5'));
    
    // Short comment
    const commentInput = screen.getByLabelText(/Comment \*/i);
    fireEvent.change(commentInput, { target: { value: 'Short' } });
    
    const submitBtn = screen.getByRole('button', { name: /Submit Review/i });
    fireEvent.click(submitBtn);
    
    expect(await screen.findByText(/Comment must be at least 10 characters/i)).toBeInTheDocument();
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('calls onCancel when cancel button is clicked', () => {
    render(<ReviewForm {...defaultProps} />);
    
    const cancelBtn = screen.getByRole('button', { name: /Cancel/i });
    fireEvent.click(cancelBtn);
    
    expect(mockOnCancel).toHaveBeenCalled();
  });

  it('handles submission error', async () => {
    mockOnSubmit.mockRejectedValueOnce(new Error('Submission failed'));
    
    // Spy on console.error to suppress expected error logging
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    render(<ReviewForm {...defaultProps} />);
    
    // Fill valid data
    fireEvent.click(screen.getByTestId('star-4'));
    fireEvent.change(screen.getByLabelText(/Comment \*/i), { target: { value: 'Good product, worth the price.' } });
    
    const submitBtn = screen.getByRole('button', { name: /Submit Review/i });
    fireEvent.click(submitBtn);
    
    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalled();
    });
    
    // Button should be re-enabled after error (loading state reset)
    expect(submitBtn).not.toBeDisabled();
    expect(screen.getByText('Submit Review')).toBeInTheDocument();

    consoleSpy.mockRestore();
  });
});
