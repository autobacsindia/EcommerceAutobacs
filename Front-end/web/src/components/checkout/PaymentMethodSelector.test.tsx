/**
 * The payment step must SHOW EMI. It used to offer one option, "Razorpay (Card/UPI/Wallet)",
 * so shoppers concluded the store had no EMI even though the Razorpay window listed it.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import PaymentMethodSelector from './PaymentMethodSelector';

describe('PaymentMethodSelector', () => {
  it('offers both "pay in full" and an EMI choice', () => {
    render(<PaymentMethodSelector selectedMethod="razorpay" onSelect={() => {}} />);
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => (r as HTMLInputElement).value)).toEqual(['razorpay', 'razorpay_emi']);
    expect(screen.getByText(/EMI — pay monthly on your card/)).toBeInTheDocument();
  });

  it('selects EMI when the shopper picks it', () => {
    const onSelect = jest.fn();
    render(<PaymentMethodSelector selectedMethod="razorpay" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('radio', { name: /EMI/ }));
    expect(onSelect).toHaveBeenCalledWith('razorpay_emi');
  });

  it('marks the current choice as checked', () => {
    render(<PaymentMethodSelector selectedMethod="razorpay_emi" onSelect={() => {}} />);
    expect(screen.getByRole('radio', { name: /EMI/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Card, UPI/ })).not.toBeChecked();
  });

  it('quotes no rates or banks of its own — the interest is the bank\'s, shown by Razorpay', () => {
    render(<PaymentMethodSelector selectedMethod="razorpay" onSelect={() => {}} />);
    expect(screen.getByText(/interest is charged by your bank/i)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\d+(\.\d+)?\s*%/);
  });
});
