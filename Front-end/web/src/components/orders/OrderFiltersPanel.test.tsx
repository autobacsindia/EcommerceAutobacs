import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import OrderFiltersPanel, { OrderFilters } from './OrderFiltersPanel';

jest.mock('lucide-react', () => ({
  Search: () => <span>SearchIcon</span>,
  X: () => <span>XIcon</span>,
  Filter: () => <span>FilterIcon</span>,
  Calendar: () => <span>CalendarIcon</span>,
  Loader2: (p: { 'aria-label'?: string }) => <span role="status" aria-label={p['aria-label']}>Spinner</span>,
}));

const searchBox = () => screen.getByRole('searchbox', { name: 'Search orders' }) as HTMLInputElement;

const emptyFilters: OrderFilters = {
  search: '',
  statuses: [],
  paymentStatuses: [],
  startDate: '',
  endDate: '',
  minAmount: '',
  maxAmount: '',
  customer: '',
};

describe('OrderFiltersPanel', () => {
  it('debounces free-text input so it applies once after the user pauses', () => {
    jest.useFakeTimers();
    const onFiltersChange = jest.fn();
    render(<OrderFiltersPanel filters={emptyFilters} onFiltersChange={onFiltersChange} autoApply />);

    // Search is always on show — no need to open "Filters" first.
    const input = searchBox();

    // Two quick keystrokes must NOT fire a request each.
    fireEvent.change(input, { target: { value: 'ab' } });
    fireEvent.change(input, { target: { value: 'abc' } });
    expect(onFiltersChange).not.toHaveBeenCalled();

    act(() => { jest.advanceTimersByTime(350); });

    expect(onFiltersChange).toHaveBeenCalledTimes(1);
    expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ search: 'abc' }));
    jest.useRealTimers();
  });

  it('applies a quick filter immediately and toggles it off on a second click', () => {
    const onFiltersChange = jest.fn();
    render(<OrderFiltersPanel filters={emptyFilters} onFiltersChange={onFiltersChange} autoApply />);

    const toFulfill = screen.getByRole('button', { name: 'To fulfill' });

    // First click selects the real 'processing' status (no phantom 'pending'), instantly.
    fireEvent.click(toFulfill);
    expect(onFiltersChange).toHaveBeenLastCalledWith(expect.objectContaining({ statuses: ['processing'] }));
    expect(toFulfill).toHaveAttribute('aria-pressed', 'true');

    // Second click toggles it back off.
    fireEvent.click(toFulfill);
    expect(onFiltersChange).toHaveBeenLastCalledWith(expect.objectContaining({ statuses: [] }));
    expect(toFulfill).toHaveAttribute('aria-pressed', 'false');
  });

  // Regression: the panel used to sync `localFilters` from the prop on every parent
  // render. The parent echoes each committed filter set back as a NEW object, and that
  // echo arrives a router transition later — so anything typed in the gap was wiped and
  // the search box visibly rebounded to the older text mid-word.
  it('does not rebound the search box when the parent echoes an older commit back', () => {
    jest.useFakeTimers();
    const onFiltersChange = jest.fn();
    const { rerender } = render(
      <OrderFiltersPanel filters={emptyFilters} onFiltersChange={onFiltersChange} autoApply />,
    );

    const input = searchBox();

    fireEvent.change(input, { target: { value: 'abc' } });
    act(() => { jest.advanceTimersByTime(350); });
    expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ search: 'abc' }));

    // The admin keeps typing while the parent's re-render is still in flight...
    fireEvent.change(input, { target: { value: 'abcd' } });
    // ...and only now does the echo of the earlier commit land.
    rerender(
      <OrderFiltersPanel
        filters={{ ...emptyFilters, search: 'abc' }}
        onFiltersChange={onFiltersChange}
        autoApply
      />,
    );

    expect(input.value).toBe('abcd');
    jest.useRealTimers();
  });

  // The echo guard must not deafen the panel to real external changes.
  it('still adopts a filter change that did not come from itself', () => {
    jest.useFakeTimers();
    const onFiltersChange = jest.fn();
    const { rerender } = render(
      <OrderFiltersPanel filters={emptyFilters} onFiltersChange={onFiltersChange} autoApply />,
    );

    const input = searchBox();

    fireEvent.change(input, { target: { value: 'abc' } });
    act(() => { jest.advanceTimersByTime(350); });

    rerender(
      <OrderFiltersPanel
        filters={{ ...emptyFilters, search: 'reset-from-elsewhere' }}
        onFiltersChange={onFiltersChange}
        autoApply
      />,
    );

    expect(input.value).toBe('reset-from-elsewhere');
    jest.useRealTimers();
  });

  // A filter arriving from the URL must be visible, not hidden behind a collapsed panel.
  it('starts expanded when it is handed filters that are already active', () => {
    render(
      <OrderFiltersPanel
        filters={{ ...emptyFilters, search: 'moto' }}
        onFiltersChange={jest.fn()}
        autoApply
      />,
    );

    expect(searchBox().value).toBe('moto');
  });

  it('starts collapsed when no filter is active — the search box still shows', () => {
    render(<OrderFiltersPanel filters={emptyFilters} onFiltersChange={jest.fn()} autoApply />);
    expect(screen.queryByPlaceholderText(/name, email, or phone/i)).not.toBeInTheDocument();
    expect(searchBox()).toBeInTheDocument();
  });

  // Staff asked for "a search button": the box used to sit inside the collapsed panel.
  it('a search alone does not open the advanced filters', () => {
    render(<OrderFiltersPanel filters={{ ...emptyFilters, search: 'moto' }} onFiltersChange={jest.fn()} autoApply />);
    expect(searchBox().value).toBe('moto');
    expect(screen.queryByPlaceholderText(/name, email, or phone/i)).not.toBeInTheDocument();
  });

  it('Enter searches at once, without waiting for the pause', () => {
    jest.useFakeTimers();
    const onFiltersChange = jest.fn();
    render(<OrderFiltersPanel filters={emptyFilters} onFiltersChange={onFiltersChange} autoApply />);
    fireEvent.change(searchBox(), { target: { value: '#ECD8464E' } });
    fireEvent.keyDown(searchBox(), { key: 'Enter' });
    expect(onFiltersChange).toHaveBeenCalledTimes(1);
    expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ search: '#ECD8464E' }));
    // The pending debounce was cancelled: no second request.
    act(() => { jest.advanceTimersByTime(1000); });
    expect(onFiltersChange).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it('the clear button empties the search at once', () => {
    const onFiltersChange = jest.fn();
    render(<OrderFiltersPanel filters={{ ...emptyFilters, search: 'roof' }} onFiltersChange={onFiltersChange} autoApply />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ search: '' }));
    expect(searchBox().value).toBe('');
  });

  it('shows a spinner in the box while a search is loading', () => {
    const { rerender } = render(<OrderFiltersPanel filters={{ ...emptyFilters, search: 'roof' }} onFiltersChange={jest.fn()} autoApply searching />);
    expect(screen.getByRole('status', { name: 'Searching' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument();
    rerender(<OrderFiltersPanel filters={{ ...emptyFilters, search: 'roof' }} onFiltersChange={jest.fn()} autoApply />);
    expect(screen.queryByRole('status', { name: 'Searching' })).not.toBeInTheDocument();
  });

  it('surfaces unpaid outcomes via the "Unpaid / abandoned" quick filter', () => {
    const onFiltersChange = jest.fn();
    render(<OrderFiltersPanel filters={emptyFilters} onFiltersChange={onFiltersChange} autoApply />);

    const unpaid = screen.getByRole('button', { name: 'Unpaid / abandoned' });

    fireEvent.click(unpaid);
    expect(onFiltersChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ paymentStatuses: ['failed', 'cancelled', 'expired'] }),
    );
    expect(unpaid).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(unpaid);
    expect(onFiltersChange).toHaveBeenLastCalledWith(expect.objectContaining({ paymentStatuses: [] }));
    expect(unpaid).toHaveAttribute('aria-pressed', 'false');
  });
});
