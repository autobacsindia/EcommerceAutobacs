import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CustomerBankCard from './CustomerBankCard';

const get = jest.fn();
const put = jest.fn();
const del = jest.fn();
jest.mock('@/lib/api-client', () => ({
  __esModule: true,
  default: {
    get: (...a: unknown[]) => get(...a),
    put: (...a: unknown[]) => put(...a),
    delete: (...a: unknown[]) => del(...a),
  },
}));

const SAVED = { accountName: 'Big Build Pvt Ltd', accountNumber: 'XXXXXXXX9012', last4: '9012', ifsc: 'HDFC0001234', bankName: 'HDFC Bank', savedBy: 'Asha', updatedAt: '2026-10-17T05:00:00Z' };
const reply = (over = {}) => ({ success: true, account: null, canReveal: false, canSave: true, hasMobile: true, ...over });

const renderCard = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <CustomerBankCard kind="quotation" id="q1" />
  </QueryClientProvider>,
);

beforeEach(() => {
  get.mockReset(); put.mockReset(); del.mockReset();
  jest.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('CustomerBankCard', () => {
  it('saves only once the details are complete and both numbers match', async () => {
    get.mockResolvedValue(reply());
    put.mockResolvedValue(reply({ account: SAVED }));
    renderCard();

    fireEvent.click(await screen.findByRole('button', { name: 'Add bank details' }));
    expect(screen.getByText(/never enter card numbers/i)).toBeInTheDocument();
    const save = screen.getByRole('button', { name: /save bank details/i });
    fireEvent.change(screen.getByLabelText('Account holder name'), { target: { value: 'Big Build Pvt Ltd' } });
    fireEvent.change(screen.getByLabelText('Account number'), { target: { value: '1234 5678 9012' } });
    fireEvent.change(screen.getByLabelText('Confirm account number'), { target: { value: '123456789013' } });
    fireEvent.change(screen.getByLabelText('IFSC'), { target: { value: 'hdfc0001234' } });
    expect(save).toBeDisabled();
    expect(screen.getByText('The two account numbers do not match.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Confirm account number'), { target: { value: '123456789012' } });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(put).toHaveBeenCalledWith('/staff/customer-bank/quotation/q1', {
      accountName: 'Big Build Pvt Ltd', accountNumber: '123456789012', confirmAccountNumber: '123456789012', ifsc: 'HDFC0001234', bankName: '',
    }));
    expect(await screen.findByText('XXXXXXXX9012')).toBeInTheDocument();
  });

  it('shows the number masked, with no way to reveal it for a seller', async () => {
    get.mockResolvedValue(reply({ account: SAVED }));
    renderCard();
    expect(await screen.findByText('XXXXXXXX9012')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /show full number/i })).not.toBeInTheDocument();
  });

  it('accounts / admin can show the full number, and hide it again', async () => {
    get.mockImplementation((url: string) => Promise.resolve(url.endsWith('?reveal=1')
      ? reply({ canReveal: true, account: { ...SAVED, accountNumber: '123456789012' } })
      : reply({ canReveal: true, account: SAVED })));
    renderCard();

    fireEvent.click(await screen.findByRole('button', { name: /show full number/i }));
    expect(await screen.findByText('123456789012')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/staff/customer-bank/quotation/q1?reveal=1');
    fireEvent.click(screen.getByRole('button', { name: /hide/i }));
    expect(screen.getByText('XXXXXXXX9012')).toBeInTheDocument();
  });

  it('can remove the saved details', async () => {
    get.mockResolvedValue(reply({ account: SAVED }));
    del.mockResolvedValue(reply());
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: /remove/i }));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/staff/customer-bank/quotation/q1'));
    expect(await screen.findByText('No bank details saved for this customer.')).toBeInTheDocument();
  });

  it('shows nothing to someone who may not see it', async () => {
    get.mockRejectedValue(Object.assign(new Error('nf'), { status: 404 }));
    const { container } = renderCard();
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
