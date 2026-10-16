import { render, screen } from '@testing-library/react';
import { GatewayOfferRows, PaymentStatusTag } from './PaymentSummary';

describe('PaymentStatusTag', () => {
  it.each([
    ['paid', 'Paid'],
    ['pending', 'Awaiting payment'],
    ['failed', 'Payment failed'],
    ['refunded', 'Refunded'],
    ['expired', 'Payment link expired'],
    [undefined, 'Awaiting payment'],
  ])('%s → %s', (status, label) => {
    render(<PaymentStatusTag paymentStatus={status} />);
    expect(screen.getByTestId('payment-status-tag')).toHaveTextContent(label);
  });
});

describe('GatewayOfferRows', () => {
  it('shows the Razorpay offer and what the customer actually paid', () => {
    render(<GatewayOfferRows offer={{ name: 'Flat ₹100 off on Amex', discount: 100, amountPaid: 2076 }} />);
    expect(screen.getByText('Flat ₹100 off on Amex')).toBeInTheDocument();
    expect(screen.getByText('-₹100.00')).toBeInTheDocument();
    expect(screen.getByText('You paid')).toBeInTheDocument();
    expect(screen.getByText('₹2,076.00')).toBeInTheDocument();
  });

  it('renders nothing without an offer', () => {
    const { container } = render(<GatewayOfferRows offer={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
