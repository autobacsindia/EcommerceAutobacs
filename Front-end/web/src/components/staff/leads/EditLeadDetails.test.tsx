import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EditLeadDetails from './EditLeadDetails';

const patch = jest.fn();
jest.mock('@/lib/api-client', () => ({
  __esModule: true,
  default: { patch: (...a: unknown[]) => patch(...a) },
}));

const CONTACT = { name: 'Rahul K', phone: '9876500001', email: 'rahul@mail.test' };
beforeEach(() => patch.mockReset());

const setup = () => {
  const props = { onSaved: jest.fn(), onConflict: jest.fn(), onCancel: jest.fn() };
  render(<EditLeadDetails leadId="L1" contact={CONTACT} {...props} />);
  return props;
};

describe('EditLeadDetails', () => {
  it('sends the new values plus what the form opened with', async () => {
    patch.mockResolvedValue({ success: true, outcome: 'saved', lead: { id: 'L1' } });
    const { onSaved } = setup();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Rahul Kumar' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(patch).toHaveBeenCalledWith('/staff/leads/L1', {
      name: 'Rahul Kumar', phone: '9876500001', email: 'rahul@mail.test',
      seen: { name: 'Rahul K', phone: '9876500001', email: 'rahul@mail.test' },
    });
  });

  it('a 409 hands the newer version to onConflict instead of showing an error', async () => {
    const newer = { success: false, outcome: 'changed', message: 'Someone changed this lead just now.', lead: { id: 'L1' } };
    patch.mockRejectedValue({ rawData: newer });
    const { onConflict, onSaved } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }));
    await waitFor(() => expect(onConflict).toHaveBeenCalledWith(newer));
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("shows the server's refusal (e.g. 403 / bad phone) and stays open", async () => {
    patch.mockRejectedValue({ rawData: { message: 'Type a 10-digit phone number.' } });
    setup();
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('10-digit');
  });
});
