/**
 * Shipping details in the status-change modal, with focus on the free-text
 * "Other" carrier: couriers outside our list are common for regional shipments,
 * so the dropdown must offer an escape hatch that still yields a real courier
 * name on the order (and the customer email), never a blank one.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ConfirmStatusChangeModal from './ConfirmStatusChangeModal';
import apiClient from '@/lib/api';

jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

const renderShipModal = (onConfirm = jest.fn().mockResolvedValue(undefined)) => {
  render(
    <ConfirmStatusChangeModal
      orderNumber="ORD-001"
      currentStatus="processing"
      newStatus="shipped"
      notifiesCustomer
      onConfirm={onConfirm}
      onClose={jest.fn()}
    />
  );
  return onConfirm;
};

describe('ConfirmStatusChangeModal — carrier selection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (apiClient.get as jest.Mock).mockResolvedValue({
      carriers: [
        { name: 'Delhivery', code: 'DELHIVERY' },
        { name: 'Other courier', code: 'OTHER', custom: true },
      ],
    });
  });

  const fillTracking = (value = 'TRK123456789') =>
    fireEvent.change(screen.getByLabelText(/tracking number/i), { target: { value } });

  it('shows the courier-name input only when "Other" is selected', async () => {
    renderShipModal();
    await screen.findByRole('option', { name: 'Other courier' });

    expect(screen.queryByLabelText(/courier name/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/carrier/i), { target: { value: 'OTHER' } });
    expect(screen.getByLabelText(/courier name/i)).toBeInTheDocument();

    // Switching back to a listed carrier hides it again.
    fireEvent.change(screen.getByLabelText(/carrier/i), { target: { value: 'DELHIVERY' } });
    expect(screen.queryByLabelText(/courier name/i)).not.toBeInTheDocument();
  });

  it('passes the typed courier name through with the shipping payload', async () => {
    const onConfirm = renderShipModal();
    await screen.findByRole('option', { name: 'Other courier' });

    fillTracking();
    fireEvent.change(screen.getByLabelText(/carrier/i), { target: { value: 'OTHER' } });
    fireEvent.change(screen.getByLabelText(/courier name/i), {
      target: { value: '  Trackon Couriers  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith(
        expect.objectContaining({
          shipping: expect.objectContaining({
            trackingNumber: 'TRK123456789',
            carrierCode: 'OTHER',
            carrierName: 'Trackon Couriers',
          }),
        })
      );
    });
  });

  it('blocks submit when "Other" is chosen with a blank courier name', async () => {
    const onConfirm = renderShipModal();
    await screen.findByRole('option', { name: 'Other courier' });

    fillTracking();
    fireEvent.change(screen.getByLabelText(/carrier/i), { target: { value: 'OTHER' } });
    fireEvent.change(screen.getByLabelText(/courier name/i), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));

    expect(await screen.findByText(/enter the courier name/i)).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('omits carrierName for a listed carrier', async () => {
    const onConfirm = renderShipModal();
    await screen.findByRole('option', { name: 'Delhivery' });

    fillTracking();
    fireEvent.change(screen.getByLabelText(/carrier/i), { target: { value: 'DELHIVERY' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
    expect(onConfirm.mock.calls[0][0].shipping.carrierName).toBeUndefined();
  });

  it('still offers "Other" when the carriers lookup fails', async () => {
    (apiClient.get as jest.Mock).mockRejectedValue(new Error('carriers down'));
    const onConfirm = renderShipModal();

    // The dropdown never populates, but a shipment must not be blocked on it.
    const otherOption = await screen.findByRole('option', { name: 'Other courier' });
    expect(otherOption).toBeInTheDocument();

    fillTracking();
    fireEvent.change(screen.getByLabelText(/carrier/i), { target: { value: 'OTHER' } });
    fireEvent.change(screen.getByLabelText(/courier name/i), { target: { value: 'Local Cargo' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith(
        expect.objectContaining({
          shipping: expect.objectContaining({ carrierCode: 'OTHER', carrierName: 'Local Cargo' }),
        })
      );
    });
  });
});
