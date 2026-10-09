import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import StoreSearch from './StoreSearch';

const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
jest.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
jest.mock('@/lib/analytics', () => ({ trackSearch: jest.fn() }));
jest.mock('@/components/home/redesign/Img', () => ({ __esModule: true, default: () => <span data-testid="thumb" /> }));
jest.mock('@/hooks/queries/useBrands', () => ({
  useBrands: () => ({ data: [{ name: 'Brembo', slug: 'brembo', productCount: 3 }, { name: 'Bushranger', slug: 'bushranger', productCount: 38 }] }),
}));
jest.mock('@/hooks/queries/useCategories', () => ({
  useCategories: () => ({ data: [{ _id: 'c1', name: 'Brakes', slug: 'brakes', parent: null }, { _id: 'c2', name: 'Brake Pads', slug: 'brake-pads', parent: 'c1' }] }),
}));
jest.mock('@/hooks/queries/useVehicleMakes', () => ({ useVehicleMakes: () => ({ data: [{ _id: 'BMW', name: 'BMW' }, { _id: 'Kia', name: 'Kia' }] }) }));
const get = jest.fn();
jest.mock('@/lib/api', () => ({ __esModule: true, default: { get: (...a: unknown[]) => get(...a) } }));

const renderSearch = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <StoreSearch />
    </QueryClientProvider>,
  );
const box = () => screen.getByLabelText('Search products');

beforeEach(() => {
  push.mockReset();
  get.mockReset();
  localStorage.clear();
});

describe('header search suggestions', () => {
  it('suggests from the FIRST letter — car makes, brands and departments', () => {
    renderSearch();
    fireEvent.focus(box());
    fireEvent.change(box(), { target: { value: 'b' } });
    const names = screen.getAllByRole('option').map((o) => o.textContent);
    expect(names.some((t) => t?.includes('BMW'))).toBe(true);
    expect(names.some((t) => t?.includes('Brembo'))).toBe(true);
    expect(names.some((t) => t?.includes('Brakes'))).toBe(true);
    // Sub-categories stay out of the quick list; Kia does not start with "b".
    expect(names.some((t) => t?.includes('Brake Pads'))).toBe(false);
    expect(names.some((t) => t?.includes('Kia'))).toBe(false);
    expect(get).not.toHaveBeenCalled(); // the server ignores 1-letter queries
  });

  it('a car-make suggestion opens the parts that fit it', () => {
    renderSearch();
    fireEvent.change(box(), { target: { value: 'b' } });
    fireEvent.click(screen.getByRole('option', { name: /BMW/ }));
    expect(push).toHaveBeenCalledWith('/products?vehicleMake=BMW');
  });

  it('from two letters, product suggestions come from the server and open the product', async () => {
    jest.useFakeTimers();
    get.mockResolvedValue({ success: true, suggestions: [{ id: 'p1', slug: 'bmw-f10-steering-wheel', text: 'BMW F10 Steering Wheel', type: 'product', imageUrl: 'x.jpg' }] });
    renderSearch();
    fireEvent.change(box(), { target: { value: 'bm' } });
    await act(async () => { jest.advanceTimersByTime(300); });
    jest.useRealTimers();
    const opt = await screen.findByRole('option', { name: /BMW F10 Steering Wheel/ });
    expect(get.mock.calls[0][0]).toContain('/products/suggestions?q=bm');
    fireEvent.click(opt);
    expect(push).toHaveBeenCalledWith('/products/bmw-f10-steering-wheel');
  });

  it('Enter searches, remembers the term, and shows it as a recent search next time', async () => {
    renderSearch();
    fireEvent.change(box(), { target: { value: 'winch' } });
    fireEvent.submit(box().closest('form')!);
    expect(push).toHaveBeenCalledWith('/products/search?q=winch');
    fireEvent.change(box(), { target: { value: '' } });
    fireEvent.focus(box());
    await waitFor(() => expect(screen.getByRole('option', { name: /winch/ })).toBeInTheDocument());
  });

  it('arrow keys move through suggestions and Enter opens the highlighted one', () => {
    renderSearch();
    fireEvent.change(box(), { target: { value: 'b' } });
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(push).toHaveBeenCalledTimes(1);
  });
});
