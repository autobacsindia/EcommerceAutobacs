import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SeoReviewControl from './SeoReviewControl';
import { seoReviewStatus } from '@/lib/seoReview';

const patch = jest.fn();
jest.mock('@/lib/api-client', () => ({ __esModule: true, default: { patch: (...a: unknown[]) => patch(...a) } }));

const renderControl = (initial?: { status?: 'todo' | 'in_progress' | 'done'; updatedAt?: string } | null) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SeoReviewControl productId="p1" initial={initial} />
    </QueryClientProvider>,
  );

beforeEach(() => patch.mockReset());

describe('SeoReviewControl', () => {
  it('treats a never-marked product as "Needs check"', () => {
    renderControl(null);
    expect(screen.getByRole('button', { name: 'Needs check' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/Not marked yet/)).toBeInTheDocument();
  });

  it('saves "Completed" straight away and shows it', async () => {
    patch.mockResolvedValue({ success: true, seoReview: { status: 'done', updatedAt: '2026-10-07T06:00:00Z' } });
    renderControl({ status: 'in_progress' });

    fireEvent.click(screen.getByRole('button', { name: /Completed/ }));

    await waitFor(() => expect(patch).toHaveBeenCalledWith('/products/p1/seo-review', { status: 'done' }));
    expect(await screen.findByRole('button', { name: /Completed/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/Updated/)).toBeInTheDocument();
  });

  it('keeps the old status and says so when saving fails', async () => {
    patch.mockRejectedValue({ rawData: { message: 'Product not found' } });
    renderControl({ status: 'in_progress' });
    fireEvent.click(screen.getByRole('button', { name: /Completed/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Product not found');
    expect(screen.getByRole('button', { name: 'Working' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('seoReviewStatus', () => {
  it('falls back to "todo" for missing or unknown values', () => {
    expect(seoReviewStatus(undefined)).toBe('todo');
    expect(seoReviewStatus({ status: null })).toBe('todo');
    expect(seoReviewStatus({ status: 'bogus' as never })).toBe('todo');
    expect(seoReviewStatus({ status: 'done' })).toBe('done');
  });
});
