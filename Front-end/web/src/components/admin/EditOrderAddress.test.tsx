import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EditOrderAddress, { type OrderShippingAddress } from './EditOrderAddress';

const patch = jest.fn();
jest.mock('@/lib/api-client', () => ({
  __esModule: true,
  default: { patch: (...a: unknown[]) => patch(...a) },
}));

const ADDRESS: OrderShippingAddress = {
  fullName: 'Ravi', phone: '9876543210', houseNumber: 'Flat 4B', addressLine1: 'Marine Drive, Ernakulam', city: 'Kochi', state: 'Kerala', postalCode: '682001', country: 'India',
};

beforeEach(() => patch.mockReset());

describe('EditOrderAddress', () => {
  it('sends only the editable fields plus the reason, then reports the saved address', async () => {
    const saved = { shippingAddress: { ...ADDRESS, addressLine1: '12B Marine Drive' }, addressEditable: true };
    patch.mockResolvedValue(saved);
    const onSaved = jest.fn();
    render(<EditOrderAddress orderId="o1" address={ADDRESS} onSaved={onSaved} onCancel={jest.fn()} />);

    fireEvent.change(screen.getByLabelText('Street / Area *'), { target: { value: '12B Marine Drive' } });
    fireEvent.change(screen.getByLabelText('Why are you changing it? *'), { target: { value: 'Right flat number' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save address' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
    expect(patch).toHaveBeenCalledWith('/orders/o1/shipping-address', {
      address: { fullName: 'Ravi', phone: '9876543210', alternatePhone: '', houseNumber: 'Flat 4B', addressLine1: '12B Marine Drive', landmark: '', addressLine2: '', city: 'Kochi' },
      reason: 'Right flat number',
    });
  });

  it('shows PIN code and state read-only — no inputs for them', () => {
    render(<EditOrderAddress orderId="o1" address={ADDRESS} onSaved={jest.fn()} onCancel={jest.fn()} />);
    expect(screen.queryByLabelText(/PIN/)).toBeNull();
    expect(screen.queryByLabelText(/State/)).toBeNull();
    expect(screen.getByText(/PIN code 682001 · Kerala/)).toBeInTheDocument();
  });

  it("shows the server's refusal (e.g. already shipped) and stays open", async () => {
    patch.mockRejectedValue({ rawData: { message: 'This order has already been shipped, so its address can no longer be changed.' } });
    const onSaved = jest.fn();
    render(<EditOrderAddress orderId="o1" address={ADDRESS} onSaved={onSaved} onCancel={jest.fn()} />);
    fireEvent.change(screen.getByLabelText('Why are you changing it? *'), { target: { value: 'typo' } });
    fireEvent.change(screen.getByLabelText('City *'), { target: { value: 'Ernakulam' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save address' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/already been shipped/);
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save address' })).toBeEnabled();
  });

  it('an old order (no house no.) must have it added before saving — nothing is sent', async () => {
    const old = { ...ADDRESS, houseNumber: undefined, addressLine1: 'Kochi' };
    render(<EditOrderAddress orderId="o1" address={old} onSaved={jest.fn()} onCancel={jest.fn()} />);
    fireEvent.change(screen.getByLabelText('House name / flat / building no. *'), { target: { value: '-' } });
    fireEvent.change(screen.getByLabelText('Why are you changing it? *'), { target: { value: 'Add flat no.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save address' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/house name \/ number doesn't look right/);
    expect(patch).not.toHaveBeenCalled();
  });

  it('Cancel closes without saving', () => {
    const onCancel = jest.fn();
    render(<EditOrderAddress orderId="o1" address={ADDRESS} onSaved={jest.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });
});
