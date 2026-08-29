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

/**
 * Shipping from the ORDERS LIST puts every outstanding unit in ONE parcel. That fast path
 * is deliberate for that screen, but on a multi-item order it is only right by accident,
 * so the dialog has to say what it will do.
 */
describe('multi-item shipping notice', () => {
  const base = {
    orderNumber: 'AB-1234',
    currentStatus: 'processing',
    newStatus: 'shipped',
    notifiesCustomer: true,
    onConfirm: jest.fn().mockResolvedValue(undefined),
    onClose: jest.fn(),
  };

  it('names how many items go in the single parcel', () => {
    render(<ConfirmStatusChangeModal {...base} shipsEverythingCount={3} orderHref="/admin/orders/o1" />);
    expect(screen.getByText(/all 3 items/i)).toBeInTheDocument();
  });

  it('offers the order page as the way to split them', () => {
    render(<ConfirmStatusChangeModal {...base} shipsEverythingCount={3} orderHref="/admin/orders/o1" />);
    expect(screen.getByRole('link', { name: /Open the order/i })).toHaveAttribute('href', '/admin/orders/o1');
  });

  // One item cannot be split, so the warning would be noise on the common case.
  it('stays silent for a single-item order', () => {
    render(<ConfirmStatusChangeModal {...base} shipsEverythingCount={1} orderHref="/admin/orders/o1" />);
    expect(screen.queryByText(/in one parcel/i)).not.toBeInTheDocument();
  });

  it('stays silent for a non-shipping status change', () => {
    render(<ConfirmStatusChangeModal {...base} newStatus="delivered" shipsEverythingCount={3} />);
    expect(screen.queryByText(/in one parcel/i)).not.toBeInTheDocument();
  });
});

/**
 * The mirror image of the shipping notice above.
 *
 * Marking an order delivered runs deliverAllOutstanding server-side — every parcel in
 * flight lands at once, and each one emails the customer. That is deliberate (the
 * per-line return window reads parcel dates, so leaving them at `shipped` keeps every
 * window shut), but it was happening SILENTLY while the shipping equivalent one
 * transition earlier got a loud warning. Same fast path, same disclosure.
 */
describe('multi-parcel delivery notice', () => {
  const base = {
    orderNumber: 'AB-1234',
    currentStatus: 'shipped',
    newStatus: 'delivered',
    notifiesCustomer: true,
    onConfirm: jest.fn().mockResolvedValue(undefined),
    onClose: jest.fn(),
  };

  it('names how many parcels this lands at once', () => {
    render(<ConfirmStatusChangeModal {...base} deliversParcelCount={3} orderHref="/admin/orders/o1" />);
    expect(screen.getByText(/all 3 parcels/i)).toBeInTheDocument();
  });

  it('warns that the customer is emailed once per parcel', () => {
    render(<ConfirmStatusChangeModal {...base} deliversParcelCount={3} />);
    expect(screen.getByText(/once per parcel/i)).toBeInTheDocument();
  });

  it('offers the order page as the way to deliver them one at a time', () => {
    render(<ConfirmStatusChangeModal {...base} deliversParcelCount={2} orderHref="/admin/orders/o1" />);
    expect(screen.getByRole('link', { name: /Open the order/i })).toHaveAttribute('href', '/admin/orders/o1');
  });

  // A single parcel cannot be delivered "partly", so the warning would be noise on the
  // overwhelmingly common case.
  it('stays silent for a single-parcel order', () => {
    render(<ConfirmStatusChangeModal {...base} deliversParcelCount={1} />);
    expect(screen.queryByText(/parcels/i)).not.toBeInTheDocument();
  });

  it('stays silent for an order with no parcels at all', () => {
    render(<ConfirmStatusChangeModal {...base} deliversParcelCount={0} />);
    expect(screen.queryByText(/parcels/i)).not.toBeInTheDocument();
  });

  it('stays silent for a non-delivery status change', () => {
    render(<ConfirmStatusChangeModal {...base} newStatus="cancelled" deliversParcelCount={3} />);
    expect(screen.queryByText(/all 3 parcels/i)).not.toBeInTheDocument();
  });

  // Bulk spans many orders with different parcel counts — there is no single honest
  // number to quote, so the notice must not appear at all.
  it('stays silent in bulk mode', () => {
    render(
      <ConfirmStatusChangeModal
        newStatus="delivered"
        count={5}
        notifiesCustomer
        deliversParcelCount={3}
        onConfirm={jest.fn().mockResolvedValue(undefined)}
        onClose={jest.fn()}
      />,
    );
    expect(screen.queryByText(/all 3 parcels/i)).not.toBeInTheDocument();
  });
});
