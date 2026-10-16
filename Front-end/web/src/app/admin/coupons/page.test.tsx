/**
 * The coupons screen is shared by the admin and the marketing panel. In the
 * marketing panel its links stay inside /team/marketing and the delete button
 * is gone (the API refuses it too — staff never delete company records).
 */
import { render, screen } from '@testing-library/react';
import CouponsPage from './page';

let pathname = '/admin/coupons';
jest.mock('next/navigation', () => ({ usePathname: () => pathname }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => <a href={href} className={className}>{children}</a> }));
jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: {
    get: jest.fn().mockResolvedValue({
      success: true, total: 1, page: 1, pages: 1,
      coupons: [{ _id: 'c1', code: 'DIWALI10', type: 'percentage', value: 10, visibility: 'public', usedCount: 0, isActive: true }],
    }),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

const deleteButtons = () => screen.queryAllByRole('button').filter((b) => b.className.includes('text-red-600'));

it('admin: links under /admin and a delete button', async () => {
  pathname = '/admin/coupons';
  render(<CouponsPage />);
  await screen.findByText('DIWALI10');
  expect(screen.getByRole('link', { name: /New Coupon/ })).toHaveAttribute('href', '/admin/coupons/create');
  expect(document.querySelector('a[href="/admin/coupons/edit/c1"]')).not.toBeNull();
  expect(deleteButtons()).toHaveLength(1);
});

it('marketing: links stay in the marketing panel and there is no delete', async () => {
  pathname = '/team/marketing/coupons';
  render(<CouponsPage />);
  await screen.findByText('DIWALI10');
  expect(screen.getByRole('link', { name: /New Coupon/ })).toHaveAttribute('href', '/team/marketing/coupons/create');
  expect(document.querySelector('a[href="/team/marketing/coupons/edit/c1"]')).not.toBeNull();
  expect(document.querySelector('a[href^="/admin"]')).toBeNull();
  expect(deleteButtons()).toHaveLength(0);
});
