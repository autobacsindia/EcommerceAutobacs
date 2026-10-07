/**
 * The order page's single Refund button for an order cancelled line by line.
 *
 * What matters: it shows the SERVER's figures (never prices anything itself), it calls
 * the one refund-all endpoint once per press, it cannot be pressed again while running,
 * and it stays away when nothing is owed.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RefundAllPanel from './RefundAllPanel';
import apiClient from '@/lib/api';
import toast from 'react-hot-toast';

jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));
jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { success: jest.fn(), error: jest.fn() },
}));

const cx = (id: string, status: string, paise: number, extra = {}) => ({
  _id: id, sequence: 1, lines: [], refund: { productValuePaise: paise, amountPaise: 0, status, ...extra },
});

const serve = (cancellations: unknown[], refundRepairNeeded = false) =>
  (apiClient.get as jest.Mock).mockResolvedValue({ cancellations, refundRepairNeeded });

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(window, 'confirm').mockReturnValue(true);
});

it('shows the total still owed and refunds it in one press', async () => {
  serve([cx('c1', 'pending', 50000), cx('c2', 'failed', 30000, { failureReason: 'timeout' }), cx('c3', 'completed', 1000)]);
  (apiClient.post as jest.Mock).mockResolvedValue({ message: 'Refund of ₹800 sent.' });
  const onChanged = jest.fn();
  render(<RefundAllPanel orderId="o1" paymentStatus="paid" onChanged={onChanged} />);

  const button = await screen.findByRole('button', { name: 'Refund ₹800.00' });
  expect(screen.getByText(/Already refunded/)).toHaveTextContent('₹10.00');
  expect(screen.getByText(/Last attempt failed: timeout/)).toBeInTheDocument();

  fireEvent.click(button);
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/orders/o1/refund-all', {}));
  expect(apiClient.post).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
  expect(toast.success).toHaveBeenCalledWith('Refund of ₹800 sent.');
});

it('cannot fire twice while a refund is running', async () => {
  serve([cx('c1', 'pending', 1000)]);
  let finish: (v: unknown) => void = () => {};
  (apiClient.post as jest.Mock).mockReturnValue(new Promise((r) => { finish = r; }));
  render(<RefundAllPanel orderId="o1" paymentStatus="paid" />);

  const button = await screen.findByRole('button', { name: 'Refund ₹10.00' });
  fireEvent.click(button);
  await screen.findByRole('button', { name: 'Processing…' });
  fireEvent.click(screen.getByRole('button', { name: 'Processing…' }));
  expect(apiClient.post).toHaveBeenCalledTimes(1);
  finish({ message: 'ok' });
});

it('does nothing when the admin backs out of the confirm', async () => {
  (window.confirm as jest.Mock).mockReturnValue(false);
  serve([cx('c1', 'pending', 1000)]);
  render(<RefundAllPanel orderId="o1" paymentStatus="paid" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Refund ₹10.00' }));
  expect(apiClient.post).not.toHaveBeenCalled();
});

it('offers Refund for an order needing repair, even with nothing priced yet', async () => {
  serve([cx('c1', 'completed', 50000)], true);
  render(<RefundAllPanel orderId="o1" paymentStatus="paid" />);
  expect(await screen.findByRole('button', { name: 'Refund' })).toBeInTheDocument();
  expect(screen.getByText(/no refund record yet/)).toBeInTheDocument();
});

it('shows the server error and stays retryable after a partial failure', async () => {
  serve([cx('c1', 'pending', 1000)]);
  (apiClient.post as jest.Mock).mockRejectedValue(new Error('₹5 sent. 1 refund(s) failed: timeout. Press Refund again to retry only the failed one(s).'));
  render(<RefundAllPanel orderId="o1" paymentStatus="paid" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Refund ₹10.00' }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/retry only the failed/), expect.anything()));
  expect(await screen.findByRole('button', { name: 'Refund ₹10.00' })).not.toBeDisabled();
});

it('shows "Refunded" with no button once everything has gone back', async () => {
  serve([cx('c1', 'completed', 1000)]);
  render(<RefundAllPanel orderId="o1" paymentStatus="paid" />);
  expect(await screen.findByText('Refunded ✓')).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

it('renders nothing on an unpaid order or one with no cancellations', async () => {
  serve([cx('c1', 'not_applicable', 0)]);
  const { container, unmount } = render(<RefundAllPanel orderId="o1" paymentStatus="pending" />);
  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
  unmount();

  serve([]);
  const second = render(<RefundAllPanel orderId="o2" paymentStatus="paid" />);
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(2));
  expect(second.container).toBeEmptyDOMElement();
});
