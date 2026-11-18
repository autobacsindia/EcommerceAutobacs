import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MyReviewsCard, { decodeEntities } from './MyReviewsCard';

const put = jest.fn();
const getMyReviews = jest.fn();
jest.mock('@/lib/api-client', () => ({ __esModule: true, default: { put: (...a: unknown[]) => put(...a) } }));
jest.mock('@/lib/profileService', () => ({ __esModule: true, default: { getMyReviews: (...a: unknown[]) => getMyReviews(...a) } }));

const REVIEW = {
  id: 'r1', product: { id: 'p1', name: 'LED Lamp', slug: 'led-lamp', image: null }, rating: 4, title: 'Good',
  comment: 'Bright &amp; easy to fit.', isVerifiedPurchase: true, isApproved: true, helpfulCount: 0, createdAt: '2026-11-01T00:00:00Z',
};

const renderCard = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MyReviewsCard />
  </QueryClientProvider>,
);

beforeEach(() => { put.mockReset(); getMyReviews.mockReset(); });

describe('MyReviewsCard', () => {
  it('renders nothing for a customer with no reviews', async () => {
    getMyReviews.mockResolvedValue({ reviews: [], pagination: {}, count: 0 });
    const { container } = renderCard();
    await waitFor(() => expect(getMyReviews).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('edits rating and text; sends no photos; says it is checked again', async () => {
    getMyReviews.mockResolvedValue({ reviews: [REVIEW], pagination: {}, count: 1 });
    put.mockResolvedValue({ success: true });
    renderCard();

    fireEvent.click(await screen.findByRole('button', { name: /Edit/ }));
    expect(screen.getByLabelText('Your review')).toHaveValue('Bright & easy to fit.');
    fireEvent.click(screen.getByRole('button', { name: '2 stars' }));
    fireEvent.change(screen.getByLabelText('Your review'), { target: { value: 'Stopped working after a month.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save review' }));

    await waitFor(() => expect(put).toHaveBeenCalledWith('/reviews/r1', { rating: 2, title: 'Good', comment: 'Stopped working after a month.' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/check it again/);
  });

  it('blocks a too-short review before sending, and shows a server refusal', async () => {
    getMyReviews.mockResolvedValue({ reviews: [REVIEW], pagination: {}, count: 1 });
    put.mockRejectedValue({ rawData: { message: 'Not authorized to update this review' } });
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: /Edit/ }));
    fireEvent.change(screen.getByLabelText('Your review'), { target: { value: 'short' } });
    expect(screen.getByRole('button', { name: 'Save review' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Your review'), { target: { value: 'Long enough review text.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save review' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Not authorized');
  });

  it('decodeEntities undoes the stored HTML escaping', () => {
    expect(decodeEntities('a &amp; b &lt;3<br>next')).toBe('a & b <3\nnext');
  });
});
