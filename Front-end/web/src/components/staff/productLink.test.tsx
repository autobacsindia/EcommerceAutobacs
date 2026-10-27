/**
 * "Open this product on the website" links in the admin and team panels.
 *
 * The contract: a new tab (a half-filled order must never be lost), the click
 * never reaches the row or picker it sits in, the variant is carried through,
 * and anything without a real product id (a custom item, a goodie) is plain text.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ProductLink from './ProductLink';
import NewSalesOrderForm from './sales/NewSalesOrderForm';
import QuotationDetail from './sales/QuotationDetail';
import { productIdOf, productLinkHref } from '@/lib/productLink';
import type { Quotation } from './sales/types';

const get = jest.fn();
jest.mock('@/lib/api-client', () => ({ __esModule: true, default: { get: (...a: unknown[]) => get(...a), post: jest.fn(), put: jest.fn() } }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

const P = 'a'.repeat(24);
const V = 'b'.repeat(24);

const withQuery = (ui: React.ReactElement) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
);

beforeEach(() => get.mockReset().mockResolvedValue({ products: [] }));

describe('productLinkHref', () => {
  it('links an id, a populated product, and its variant', () => {
    expect(productLinkHref(P)).toBe(`/team/product/${P}`);
    expect(productLinkHref({ _id: P, name: 'x' } as never)).toBe(`/team/product/${P}`);
    expect(productLinkHref({ id: P })).toBe(`/team/product/${P}`);
    expect(productLinkHref(P, V)).toBe(`/team/product/${P}?variant=${V}`);
  });

  it('has nothing to link without a real product id', () => {
    for (const ref of [null, undefined, '', 'not-an-id', { _id: null }, `${P}/../x`]) expect(productLinkHref(ref)).toBeNull();
    expect(productIdOf(`${P}x`)).toBeNull();
  });

  it('drops a malformed variant rather than passing it on', () => {
    expect(productLinkHref(P, 'x"><script>')).toBe(`/team/product/${P}`);
  });
});

describe('<ProductLink>', () => {
  it('opens the product in a new tab, safely', () => {
    render(<ProductLink product={P} variantId={V}>Coilover kit</ProductLink>);
    const a = screen.getByRole('link', { name: /Coilover kit/ });
    expect(a).toHaveAttribute('href', `/team/product/${P}?variant=${V}`);
    expect(a).toHaveAttribute('target', '_blank');
    expect(a).toHaveAttribute('rel', 'noopener noreferrer');
    expect(a).toHaveAccessibleName(/opens on the website in a new tab/);
  });

  it('never lets the click reach the row it sits in', () => {
    const rowClick = jest.fn();
    render(<div onClick={rowClick}><ProductLink product={P}>Coilover kit</ProductLink></div>);
    fireEvent.click(screen.getByRole('link'));
    expect(rowClick).not.toHaveBeenCalled();
  });

  it('is plain text when there is no product (custom item, goodie)', () => {
    render(<ProductLink product={null}>Fitting labour</ProductLink>);
    expect(screen.getByText('Fitting labour')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('a photo beside a linked name is skipped by keyboard and screen readers', () => {
    // eslint-disable-next-line @next/next/no-img-element
    const { container } = render(<ProductLink product={P} decorative><img alt="" src="x.jpg" /></ProductLink>);
    const a = container.querySelector('a')!;
    expect(a).toHaveAttribute('tabindex', '-1');
    expect(a).toHaveAttribute('aria-hidden', 'true');
    expect(a).toHaveAttribute('target', '_blank');
  });
});

describe('new quotation form', () => {
  const product = { id: P, name: 'Coilover kit', sku: 'CK-1', image: '', price: 38500, available: true, variants: [] };

  it('a search result links to the website, and clicking it does not add the product', async () => {
    get.mockResolvedValue({ products: [product] });
    withQuery(<NewSalesOrderForm />);
    fireEvent.change(screen.getByLabelText('Search products'), { target: { value: 'coil' } });

    const link = await screen.findByRole('link', { name: /Coilover kit/ });
    expect(link).toHaveAttribute('href', `/team/product/${P}`);
    expect(link).toHaveAttribute('target', '_blank');
    fireEvent.click(link);
    expect(screen.queryByLabelText(/Offer price for Coilover kit/)).toBeNull();

    // The Add button still adds it — and the added line links too.
    fireEvent.click(screen.getByRole('button', { name: /Add · / }));
    expect(screen.getByLabelText(/Offer price for Coilover kit/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Coilover kit/ })).toHaveAttribute('href', `/team/product/${P}`);
  });

  it('an added variant links to that variant; a custom item has no link', async () => {
    get.mockResolvedValue({ products: [{ ...product, variants: [{ id: V, label: 'Front pair', price: 21000, available: true }] }] });
    withQuery(<NewSalesOrderForm />);
    fireEvent.change(screen.getByLabelText('Search products'), { target: { value: 'coil' } });
    fireEvent.click(await screen.findByRole('button', { name: /Front pair/ }));
    fireEvent.click(screen.getByRole('button', { name: /Custom item \(not in the catalogue\)/ }));

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', `/team/product/${P}?variant=${V}`);
    expect(links[0]).toHaveAccessibleName(/Coilover kit — Front pair/);
  });
});

it('quotation details link each catalogue line, not custom ones', async () => {
  const quotation: Quotation = {
    id: 'q1', number: 'QT-1', version: 1, status: 'open',
    customer: { name: 'Ravi Kumar', email: '', phone: '9876543210' }, shippingAddress: null,
    items: [
      { product: P, variantId: V, variantLabel: 'Front pair', custom: false, name: 'Coilover kit', image: '', quantity: 1, price: 21000, listPrice: null },
      { product: null, variantId: null, variantLabel: null, custom: true, name: 'Fitting labour', image: '', quantity: 1, price: 1500, listPrice: null },
    ],
    totalAmount: 22500, notes: '', validUntil: new Date(Date.now() + 86400000).toISOString(), salesPerson: 'Asha',
    orderId: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), revisions: [],
  };
  get.mockResolvedValue({ quotation });
  withQuery(<QuotationDetail id="q1" />);
  const link = await screen.findByRole('link', { name: /Coilover kit — Front pair/ });
  expect(link).toHaveAttribute('href', `/team/product/${P}?variant=${V}`);
  expect(screen.getByText('Fitting labour').closest('a')).toBeNull();
});
