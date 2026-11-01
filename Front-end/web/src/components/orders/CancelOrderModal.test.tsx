/**
 * The customer "Cancel Order" pop-up's reason picker.
 *
 * Regression: three of the five reasons shared the value `customer_request`, so
 * picking "Changed my mind" lit up all three and the browser showed "Other" as the
 * selected radio — and the reason actually sent never said which one was meant.
 * "Payment issues" sent `payment_failed`, which the server refused outright.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CancelOrderModal from './CancelOrderModal';
import apiClient from '@/lib/api';
import { CANCELLATION_REASONS } from '@/lib/constants';

jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: { put: jest.fn() },
}));

const put = apiClient.put as jest.Mock;

const renderModal = (props: Partial<React.ComponentProps<typeof CancelOrderModal>> = {}) =>
  render(
    <CancelOrderModal
      orderId="order-1"
      orderNumber="ABCD1234"
      totalAmount={1500}
      hasPayment={false}
      onClose={jest.fn()}
      onSuccess={jest.fn()}
      {...props}
    />,
  );

const confirmAndSubmit = () => {
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel Order' }));
};

beforeEach(() => {
  put.mockReset();
  put.mockResolvedValue({ success: true, refundInitiated: false });
});

describe('CancelOrderModal — reason picker', () => {
  it('every reason has its own value', () => {
    const values = CANCELLATION_REASONS.map((r) => r.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it.each(CANCELLATION_REASONS.map((r) => r.label))('picking "%s" selects exactly that one', (label) => {
    renderModal();
    fireEvent.click(screen.getByLabelText(label));

    const checked = screen.getAllByRole('radio').filter((r) => (r as HTMLInputElement).checked);
    expect(checked).toHaveLength(1);
    expect(screen.getByLabelText(label)).toBeChecked();
  });

  it.each(CANCELLATION_REASONS.map((r) => [r.label, r.value]))(
    'sends the code of the picked reason ("%s" → %s)',
    async (label, value) => {
      renderModal();
      fireEvent.click(screen.getByLabelText(label));
      confirmAndSubmit();

      await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
      expect(put).toHaveBeenCalledWith('/orders/order-1/cancel', { reason: value, notes: undefined });
    },
  );

  it('sends the typed details with "Other"', async () => {
    renderModal();
    fireEvent.click(screen.getByLabelText('Other'));
    fireEvent.change(screen.getByLabelText(/Additional details/), { target: { value: '  Bought in store  ' } });
    confirmAndSubmit();

    await waitFor(() => expect(put).toHaveBeenCalledWith('/orders/order-1/cancel', { reason: 'other', notes: 'Bought in store' }));
  });

  it('keeps the Cancel button off until a reason and the confirmation are both given', () => {
    renderModal();
    const submit = screen.getByRole('button', { name: 'Cancel Order' });
    expect(submit).toBeDisabled();

    fireEvent.click(screen.getByLabelText('Changed my mind'));
    expect(submit).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox'));
    expect(submit).toBeEnabled();
  });

  it('a double click sends one cancel request', async () => {
    let resolve: (v: unknown) => void = () => {};
    put.mockReturnValue(new Promise((r) => { resolve = r; }));
    renderModal();
    fireEvent.click(screen.getByLabelText('Changed my mind'));
    fireEvent.click(screen.getByRole('checkbox'));

    const form = screen.getByRole('button', { name: 'Cancel Order' }).closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(put).toHaveBeenCalledTimes(1);
    resolve({ success: true });
    expect(await screen.findByText('Order Cancelled Successfully')).toBeInTheDocument();
  });

  it('shows the server message when the cancel is refused, and keeps the choice', async () => {
    put.mockRejectedValue(new Error('Please choose one of the listed cancellation reasons'));
    renderModal();
    fireEvent.click(screen.getByLabelText('Payment issues'));
    confirmAndSubmit();

    expect(await screen.findByText('Please choose one of the listed cancellation reasons')).toBeInTheDocument();
    expect(screen.getByLabelText('Payment issues')).toBeChecked();
  });
});

describe('CancelOrderModal — refund wording', () => {
  it('promises no refund on an unpaid order', () => {
    renderModal({ hasPayment: false });
    expect(screen.queryByText('Refund Information')).toBeNull();
  });

  it('shows the order total on a full cancel of a paid order', () => {
    renderModal({ hasPayment: true });
    expect(screen.getByText(/Refund amount: ₹1500\.00/)).toBeInTheDocument();
  });

  it('does not promise the full total on a partial cancel', () => {
    renderModal({ hasPayment: true, scope: 'partial', cancellableUnits: 1 });
    expect(screen.queryByText(/₹1500\.00/)).toBeNull();
    expect(screen.getByText(/the price of the cancelled items/)).toBeInTheDocument();
  });
});
