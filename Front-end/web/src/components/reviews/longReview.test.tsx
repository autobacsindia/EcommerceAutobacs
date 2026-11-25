/**
 * Long reviews: shoppers may now write up to 5,000 characters. The form never
 * cuts text off (no maxLength; a red note when over), and a long review shows
 * six lines with "Read more" so the product page stays easy to scan.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import ReviewItem, { REVIEW_FOLD_AT } from './ReviewItem';
import ReviewForm from './ReviewForm';

jest.mock('@/components/layout/EnhancedImage', () => ({ __esModule: true, default: () => null }));

const item = (comment: string) => (
  <ReviewItem id="r1" user={{ id: 'u', name: 'Asha' }} rating={5} comment={comment}
    isVerifiedPurchase={false} helpfulCount={0} createdAt="2026-11-20T10:00:00Z" />
);

describe('a long review on the product page', () => {
  it('a short one shows whole, with no button', () => {
    render(item('Fits well.'));
    expect(screen.queryByRole('button', { name: 'Read more' })).toBeNull();
  });

  it('a long one is folded, and opens and closes on request — the full text is always there', () => {
    const long = 'Great fit and neat stitching. '.repeat(Math.ceil((REVIEW_FOLD_AT + 50) / 30));
    render(item(long));
    const text = screen.getByText(long.trim());
    expect(text.className).toMatch(/line-clamp-6/);
    fireEvent.click(screen.getByRole('button', { name: 'Read more' }));
    expect(text.className).not.toMatch(/line-clamp/);
    expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('the review form', () => {
  it('takes a 4,000-character review whole, and says plainly when over 5,000', () => {
    render(<ReviewForm productId="p1" onSubmit={jest.fn()} />);
    const box = screen.getByLabelText(/Comment/) as HTMLTextAreaElement;
    expect(box).not.toHaveAttribute('maxLength');
    fireEvent.change(box, { target: { value: 'x'.repeat(4000) } });
    expect(box.value).toHaveLength(4000);
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.change(box, { target: { value: 'x'.repeat(5002) } });
    expect(screen.getByRole('alert')).toHaveTextContent(/Too long by 2 characters \(the limit is 5,000\)/);
  });
});
