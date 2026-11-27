import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PromoCodeBox from './PromoCodeBox';

const applyCoupon = jest.fn();
const removeCoupon = jest.fn();
let cart: { couponCode?: string | null } = {};

jest.mock('@/context/CartContext', () => ({
  useCart: () => ({ cart, applyCoupon, removeCoupon }),
}));

jest.mock('react-hot-toast', () => ({
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
}));
const toastFn = require('react-hot-toast').toast as jest.Mock & { success: jest.Mock };

beforeEach(() => {
  jest.clearAllMocks();
  cart = { couponCode: null };
});

const type = (v: string) => fireEvent.change(screen.getByLabelText('Promo code'), { target: { value: v } });

describe('checkout PromoCodeBox', () => {
  it('sends the typed code (trimmed, upper-cased) to the server and confirms a real discount', async () => {
    applyCoupon.mockResolvedValue({ discountApplied: true });
    render(<PromoCodeBox />);
    type('  hilux5000 ');
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(applyCoupon).toHaveBeenCalledWith('HILUX5000'));
    expect(toastFn.success).toHaveBeenCalledWith('HILUX5000 applied');
  });

  it('does not claim a discount the server did not give', async () => {
    applyCoupon.mockResolvedValue({ discountApplied: false, message: 'Saved — no discount on this order' });
    render(<PromoCodeBox />);
    type('REF10');
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(toastFn).toHaveBeenCalledWith('Saved — no discount on this order'));
    expect(toastFn.success).not.toHaveBeenCalled();
  });

  it("shows the server's refusal, e.g. an invalid or ineligible code", async () => {
    applyCoupon.mockRejectedValue(new Error('Invalid coupon code'));
    render(<PromoCodeBox />);
    type('NOPE');
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid coupon code');
  });

  it('Apply is disabled for an empty box', () => {
    render(<PromoCodeBox />);
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
  });

  it('shows the applied code and can remove it', async () => {
    cart = { couponCode: 'HILUX5000' };
    removeCoupon.mockResolvedValue(undefined);
    render(<PromoCodeBox />);
    expect(screen.getByText('HILUX5000 applied')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove coupon' }));
    await waitFor(() => expect(removeCoupon).toHaveBeenCalledTimes(1));
  });
});
