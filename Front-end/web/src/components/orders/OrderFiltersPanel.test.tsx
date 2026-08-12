import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import OrderFiltersPanel, { OrderFilters } from './OrderFiltersPanel';

jest.mock('lucide-react', () => ({
  Search: () => <span>SearchIcon</span>,
  X: () => <span>XIcon</span>,
  Filter: () => <span>FilterIcon</span>,
  Calendar: () => <span>CalendarIcon</span>,
}));

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

    // Search lives in the collapsible section — expand it first.
    fireEvent.click(screen.getByText('Filters'));
    const input = screen.getByPlaceholderText(/order id/i);

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

    fireEvent.click(screen.getByText('Filters'));
    const input = screen.getByPlaceholderText(/order id/i) as HTMLInputElement;

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

    fireEvent.click(screen.getByText('Filters'));
    const input = screen.getByPlaceholderText(/order id/i) as HTMLInputElement;

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

    expect((screen.getByPlaceholderText(/order id/i) as HTMLInputElement).value).toBe('moto');
  });

  it('starts collapsed when no filter is active', () => {
    render(<OrderFiltersPanel filters={emptyFilters} onFiltersChange={jest.fn()} autoApply />);
    expect(screen.queryByPlaceholderText(/order id/i)).not.toBeInTheDocument();
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
