import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import OfflineRefundDialog from './OfflineRefundDialog';

/**
 * The form an admin fills in to record a refund settled outside Razorpay.
 *
 * The rules worth pinning are the ones that protect money: a reference is mandatory
 * (with no gateway record it is the only evidence), and the amount can never be pushed
 * above what is refundable here.
 */

const noop = async () => {};

describe('OfflineRefundDialog', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <OfflineRefundDialog open={false} onClose={noop} onSubmit={noop} maxAmount={1500} subject="order #1" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('defaults the amount to the full refundable balance', () => {
    render(<OfflineRefundDialog open onClose={noop} onSubmit={noop} maxAmount={1500} subject="order #1" />);
    expect(screen.getByLabelText(/Amount/)).toHaveValue(1500);
  });

  it('will not submit without a reference', async () => {
    const onSubmit = jest.fn();
    render(<OfflineRefundDialog open onClose={noop} onSubmit={onSubmit} maxAmount={1500} subject="order #1" />);

    // No gateway record exists for an offline payout, so the reference is the only proof.
    expect(screen.getByRole('button', { name: /Record refund/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Reference/), { target: { value: 'UTR-991' } });
    expect(screen.getByRole('button', { name: /Record refund/ })).toBeEnabled();
  });

  it('will not submit an amount above what is refundable', async () => {
    render(<OfflineRefundDialog open onClose={noop} onSubmit={noop} maxAmount={1500} subject="order #1" />);
    fireEvent.change(screen.getByLabelText(/Reference/), { target: { value: 'UTR-991' } });
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: '2000' } });

    expect(screen.getByRole('button', { name: /Record refund/ })).toBeDisabled();
  });

  it('will not submit zero', async () => {
    render(<OfflineRefundDialog open onClose={noop} onSubmit={noop} maxAmount={1500} subject="order #1" />);
    fireEvent.change(screen.getByLabelText(/Reference/), { target: { value: 'UTR-991' } });
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: '0' } });

    expect(screen.getByRole('button', { name: /Record refund/ })).toBeDisabled();
  });

  it('submits the full payload and closes', async () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    const onClose = jest.fn();
    render(<OfflineRefundDialog open onClose={onClose} onSubmit={onSubmit} maxAmount={1500} subject="order #1" />);

    fireEvent.change(screen.getByLabelText(/How was it paid back/), { target: { value: 'upi' } });
    fireEvent.change(screen.getByLabelText(/Reference/), { target: { value: 'UPI-7788' } });
    fireEvent.click(screen.getByRole('button', { name: /Record refund/ }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      offlineMethod: 'upi', reference: 'UPI-7788', amount: 1500, notifyCustomer: true,
    })));
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps the form open and shows the error when the request fails', async () => {
    // The usual failure is an amount or reference that needs correcting; closing behind
    // a toast would mean retyping everything.
    const onSubmit = jest.fn().mockRejectedValue(new Error('₹2000 is more than the ₹1500 still refundable'));
    const onClose = jest.fn();
    render(<OfflineRefundDialog open onClose={onClose} onSubmit={onSubmit} maxAmount={1500} subject="order #1" />);

    fireEvent.change(screen.getByLabelText(/Reference/), { target: { value: 'UTR-1' } });
    fireEvent.click(screen.getByRole('button', { name: /Record refund/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/still refundable/);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('warns that Razorpay has already emailed, when notify is on', async () => {
    render(<OfflineRefundDialog open onClose={noop} onSubmit={noop} maxAmount={1500} subject="order #1" />);
    expect(screen.getByText(/Razorpay has already/)).toBeInTheDocument();
  });

  it('explains that a PARTIAL record sends no email', async () => {
    /*
      Not a preference: notifiedStatuses keys on the bare status word, so one 'refunded'
      email can ever be sent per order — spending it on a partial would silence the real one.
    */
    render(<OfflineRefundDialog open onClose={noop} onSubmit={noop} maxAmount={1500} subject="order #1" />);
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: '500' } });

    expect(screen.getByText(/only one refund email/)).toBeInTheDocument();
  });

  it('hides the notify option entirely when the surface does not email', async () => {
    // Per-line cancellations: the gateway path sends nothing, so offline must not either.
    render(
      <OfflineRefundDialog open onClose={noop} onSubmit={noop} maxAmount={400} subject="cancellation 1" allowNotify={false} />,
    );
    expect(screen.queryByText(/Email the customer/)).not.toBeInTheDocument();
  });

  it('omits notifyCustomer from the payload when the surface does not email', async () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    render(
      <OfflineRefundDialog open onClose={noop} onSubmit={onSubmit} maxAmount={400} subject="cancellation 1" allowNotify={false} />,
    );
    fireEvent.change(screen.getByLabelText(/Reference/), { target: { value: 'CASH-1' } });
    fireEvent.click(screen.getByRole('button', { name: /Record refund/ }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty('notifyCustomer');
  });

  it('prefills the reference from a failed gateway attempt', () => {
    render(
      <OfflineRefundDialog open onClose={noop} onSubmit={noop} maxAmount={1500} subject="order #1" defaultReference="rfnd_XyZ123" />,
    );
    expect(screen.getByLabelText(/Reference/)).toHaveValue('rfnd_XyZ123');
  });
});
