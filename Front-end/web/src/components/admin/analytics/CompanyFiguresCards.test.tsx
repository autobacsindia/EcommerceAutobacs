/**
 * Company revenue and sales (moved from the admin header to Analytics):
 * the figure, the breakdown on hover, the full list on click.
 */
import { render, screen } from '@testing-library/react';
import CompanyFiguresCards from './CompanyFiguresCards';

jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...rest}>{children}</a> }));

let mockResult: { isError: boolean; stats: Record<string, unknown> };
jest.mock('@/hooks/queries/useAdminStats', () => ({ useAdminStats: () => mockResult }));

const full = {
  isError: false,
  stats: {
    totalRevenue: 428950,
    revenuePeriod: { label: 'FY 26-27', startDate: '2026-04-01' },
    companyRevenue: {
      total: 14078723, zoho: 11364097, zohoExGst: 9636000, panelNotInZoho: 2714626, creditNotes: 827599, basis: 'incl_gst',
      period: { kind: 'fy', label: 'FY 26-27', startDate: '2026-04-01' }, needsCheck: { count: 3, total: 120000 },
    },
    sales: { total: 306, website: { total: 74, delivered: 35, shipped: 30, processing: 9 }, zoho: 232, zohoCancelled: 12, fyLabel: 'FY 26-27' },
  },
};

it('shows company revenue and sales, the breakdown on hover, the full list on click', () => {
  mockResult = full;
  render(<CompanyFiguresCards />);
  const revenue = screen.getByRole('link', { name: /Company revenue \(FY 26-27\)/ });
  expect(revenue).toHaveAttribute('href', '/admin/revenue');
  expect(revenue).toHaveTextContent('₹1.40 Cr');
  expect(revenue).toHaveTextContent('incl. GST');
  const rt = revenue.getAttribute('title') ?? '';
  expect(rt).toMatch(/Zoho Books bills after refunds: ₹1,13,64,097\.00 \(₹96,36,000\.00 without GST\)/);
  expect(rt).toMatch(/refunds taken off \(credit notes\): ₹8,27,599\.00/);
  expect(rt).toMatch(/not yet billed in Zoho: ₹27,14,626\.00/);
  expect(rt).toMatch(/3 Zoho bill\(s\) are probably website orders/);

  const sales = screen.getByRole('link', { name: /Company sales \(FY 26-27\)/ });
  expect(sales).toHaveAttribute('href', '/admin/revenue#sales');
  expect(sales).toHaveTextContent('306');
  expect(sales).toHaveTextContent('39 on the way');
  const st = sales.getAttribute('title') ?? '';
  expect(st).toMatch(/Billed in Zoho Books: 232/);
  expect(st).toMatch(/not yet in Zoho: 74 — delivered 35, shipped 30, processing 9/);
  expect(st).toMatch(/12 Zoho bill\(s\) cancelled by credit note/);
});

it('shows a dash, never a stale or zero figure, when the stats call fails', () => {
  mockResult = { ...full, isError: true };
  render(<CompanyFiguresCards />);
  expect(screen.getByRole('link', { name: /Company revenue/ })).toHaveTextContent('—');
  expect(screen.getByRole('link', { name: /Company sales/ })).toHaveTextContent('—');
});

it('falls back to the website-only revenue for a response from before company figures existed', () => {
  mockResult = { isError: false, stats: { totalRevenue: 428950, revenuePeriod: { label: 'FY 26-27', startDate: '2026-04-01' } } };
  render(<CompanyFiguresCards />);
  expect(screen.getByRole('link', { name: /Company revenue \(FY 26-27\)/ })).toHaveTextContent('₹4,28,950');
  expect(screen.getByRole('link', { name: /Company sales/ })).toHaveTextContent('—');
});
