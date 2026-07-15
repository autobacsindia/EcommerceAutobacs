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
    const input = screen.getByPlaceholderText(/search order #/i);

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
