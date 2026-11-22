/**
 * DeliveryFeeBreakdown renders server figures only. These pin the money-display rules:
 * fees off → "paid on delivery"; no PIN → no fees; the ₹0 + celebration appear only
 * once the SERVER says the offer is applied; a pending tap cannot be tapped again.
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import DeliveryFeeBreakdown from './DeliveryFeeBreakdown';
import { resetOfferCelebrated } from '@/hooks/useDeliveryFeeOffer';
import type { DeliveryFeesQuote } from '@/hooks/useCheckoutQuote';

const fees = (over: Partial<DeliveryFeesQuote> = {}, offer: Partial<DeliveryFeesQuote['offer']> = {}): DeliveryFeesQuote => ({
  needsPin: false,
  pin: '500001',
  place: { district: 'Hyderabad', state: 'Telangana' },
  distanceKm: 1253,
  origin: 'Delhi',
  remote: false,
  mode: 'freight',
  chargedKg: 40,
  estimated: false,
  gstOnFees: 18,
  lines: [
    { code: 'shipping', label: 'Shipping fee', amount: 640 },
    { code: 'packing', label: 'Packing fee', amount: 500 },
  ],
  total: 1140,
  offer: { code: 'blackfriday', available: true, requested: false, applied: false, saving: 0, error: null, ...offer },
  ...over,
});

const props = { requested: false, onRequestChange: jest.fn(), reducedMotionOverride: true };

beforeEach(() => { jest.clearAllMocks(); resetOfferCelebrated(); });

it('fees switched off → the old "paid on delivery" row', () => {
  render(<DeliveryFeeBreakdown {...props} fees={null} />);
  expect(screen.getByText('Extra — paid on delivery')).toBeInTheDocument();
});

it('renders nothing before the first quote', () => {
  const { container } = render(<DeliveryFeeBreakdown {...props} fees={undefined} />);
  expect(container).toBeEmptyDOMElement();
});

it('no PIN → asks for it, shows no fee lines', () => {
  render(<DeliveryFeeBreakdown {...props} fees={fees({ needsPin: true, pin: null, lines: [], total: 0, place: null, distanceKm: null })} />);
  expect(screen.getByText('Enter your PIN code to see delivery charges.')).toBeInTheDocument();
  expect(screen.queryByText('Shipping fee')).not.toBeInTheDocument();
});

it('lists each fee, the place and distance, and the total', () => {
  render(<DeliveryFeeBreakdown {...props} fees={fees()} />);
  expect(screen.getByText('Shipping fee')).toBeInTheDocument();
  expect(screen.getByText('Packing fee')).toBeInTheDocument();
  expect(screen.getByTestId('delivery-place')).toHaveTextContent('Hyderabad, Telangana · ~1,253 km from Delhi');
  expect(screen.getByText('Delivery fees total').nextSibling).toHaveTextContent('1,140');
});

it('the offer button asks the server; it is disabled while the answer is pending (double tap)', () => {
  const onRequestChange = jest.fn();
  const { rerender } = render(<DeliveryFeeBreakdown {...props} onRequestChange={onRequestChange} fees={fees()} />);
  fireEvent.click(screen.getByRole('button', { name: /Apply Black Friday offer/ }));
  expect(onRequestChange).toHaveBeenCalledWith(true);
  // Intent is now true but the quote on screen was priced without it → pending.
  rerender(<DeliveryFeeBreakdown {...props} requested onRequestChange={onRequestChange} fees={fees()} />);
  const btn = screen.getByRole('button', { name: /Applying/ });
  expect(btn).toBeDisabled();
  fireEvent.click(btn);
  expect(onRequestChange).toHaveBeenCalledTimes(1);
  // No ₹0 until the server confirms.
  expect(screen.queryByText(/you saved/)).not.toBeInTheDocument();
});

it('server-confirmed offer → fees struck through, ₹0 total, celebration once', () => {
  const { rerender } = render(<DeliveryFeeBreakdown {...props} requested fees={fees({}, { requested: true })} loading />);
  const applied = fees({}, { requested: true, applied: true, saving: 1140 });
  rerender(<DeliveryFeeBreakdown {...props} requested fees={applied} />);
  expect(screen.getByRole('dialog')).toHaveTextContent('Congratulations!');
  expect(screen.getByRole('dialog')).toHaveTextContent(/You saved\s*₹1,140/);
  expect(screen.getByText(/Black Friday offer applied — every delivery fee is ₹0/)).toBeInTheDocument();
  expect(screen.getByTestId('savings-breakdown')).toHaveTextContent(/Total savings\s*₹1,140/);
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  // A re-quote that is still applied does not celebrate again.
  rerender(<DeliveryFeeBreakdown {...props} requested fees={{ ...applied }} />);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('celebration shows once per session — not again when a new PIN re-applies the offer', () => {
  const pending = fees({}, { requested: true });
  const applied = fees({}, { requested: true, applied: true, saving: 1140 });
  const first = render(<DeliveryFeeBreakdown {...props} requested fees={pending} loading />);
  first.rerender(<DeliveryFeeBreakdown {...props} requested fees={applied} />);
  expect(screen.getByRole('dialog')).toHaveTextContent('Congratulations!');
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  // PIN changed → re-quote in flight → applied again (and on a later page/mount).
  first.rerender(<DeliveryFeeBreakdown {...props} requested fees={pending} loading />);
  first.rerender(<DeliveryFeeBreakdown {...props} requested fees={{ ...applied, total: 2200 }} />);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  first.unmount();
  const second = render(<DeliveryFeeBreakdown {...props} requested fees={pending} loading />);
  second.rerender(<DeliveryFeeBreakdown {...props} requested fees={applied} />);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  // The inline "you saved" lines still show every time.
  expect(screen.getByTestId('savings-breakdown')).toHaveTextContent(/Total savings\s*₹1,140/);
});

it('offer ended → plain notice, no button', () => {
  render(<DeliveryFeeBreakdown {...props} requested fees={fees({}, { available: false, requested: true, error: 'offer_ended' })} />);
  expect(screen.getByRole('alert')).toHaveTextContent('The Black Friday offer has ended');
  expect(screen.queryByRole('button', { name: /Apply Black Friday offer/ })).not.toBeInTheDocument();
});

it('offer not live → no button at all', () => {
  render(<DeliveryFeeBreakdown {...props} fees={fees({}, { available: false })} />);
  expect(screen.queryByRole('button', { name: /Apply/ })).not.toBeInTheDocument();
});

it('PIN box reports only a complete valid PIN', () => {
  const onChange = jest.fn();
  render(<DeliveryFeeBreakdown {...props} fees={fees({ needsPin: true, lines: [], total: 0 })} pinInput={{ value: '', onChange }} />);
  const box = screen.getByLabelText('Delivery PIN code');
  act(() => { fireEvent.change(box, { target: { value: '5000' } }); });
  expect(onChange).toHaveBeenLastCalledWith('');
  act(() => { fireEvent.change(box, { target: { value: '500001' } }); });
  expect(onChange).toHaveBeenLastCalledWith('500001');
  act(() => { fireEvent.change(box, { target: { value: '012345' } }); });
  expect(screen.getByText('Please enter a valid 6-digit PIN code.')).toBeInTheDocument();
});

it('PIN box keeps what is being typed when the parent stores the cleared PIN', () => {
  // Regression: the box copied the parent's value back over the draft, so
  // deleting one digit of a full PIN (parent now holds '') wiped all of it.
  function Parent() {
    const [pin, setPin] = React.useState('500001');
    return <DeliveryFeeBreakdown {...props} fees={fees({ needsPin: true, lines: [], total: 0 })} pinInput={{ value: pin, onChange: setPin }} />;
  }
  render(<Parent />);
  const box = screen.getByLabelText('Delivery PIN code') as HTMLInputElement;
  act(() => { fireEvent.change(box, { target: { value: '50000' } }); });
  expect(box.value).toBe('50000');
  act(() => { fireEvent.change(box, { target: { value: '500002' } }); });
  expect(box.value).toBe('500002');
});

describe('PIN first (Sachin, 2026-11-20)', () => {
  const noPin = (offer = {}) => fees({ needsPin: true, pin: null, lines: [], total: 0, place: null, distanceKm: null }, offer);

  it('tapping Apply without a PIN does NOT request the offer; it asks for the PIN and focuses the box', () => {
    const onRequestChange = jest.fn();
    render(<DeliveryFeeBreakdown {...props} onRequestChange={onRequestChange} fees={noPin()} pinInput={{ value: '', onChange: jest.fn() }} />);
    fireEvent.click(screen.getByRole('button', { name: /Apply Black Friday offer/ }));
    expect(onRequestChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('offer-needs-pin')).toHaveTextContent('Enter your PIN code first to see your delivery fees and savings');
    expect(document.activeElement).toBe(screen.getByLabelText('Delivery PIN code'));
  });

  it('server refused the waiver for no PIN (intent carried in) → same message, nothing shown as ₹0', () => {
    render(<DeliveryFeeBreakdown {...props} requested fees={noPin({ requested: true, applied: false, error: 'pin_required' })} />);
    expect(screen.getByTestId('offer-needs-pin')).toBeInTheDocument();
    expect(screen.queryByTestId('offer-applied')).not.toBeInTheDocument();
  });

  it('with a PIN, Apply requests the offer as before', () => {
    const onRequestChange = jest.fn();
    render(<DeliveryFeeBreakdown {...props} onRequestChange={onRequestChange} fees={fees()} />);
    fireEvent.click(screen.getByRole('button', { name: /Apply Black Friday offer/ }));
    expect(onRequestChange).toHaveBeenCalledWith(true);
    expect(screen.queryByTestId('offer-needs-pin')).not.toBeInTheDocument();
  });
});

describe('savings breakdown', () => {
  it('applied → delivery fees waived · discount · total savings, from the server figures', () => {
    render(
      <DeliveryFeeBreakdown
        {...props}
        requested
        fees={fees({}, { requested: true, applied: true, saving: 8000 })}
        savings={{ discount: 5000, deliveryFees: 8000, total: 13000 }}
      />,
    );
    const box = screen.getByTestId('savings-breakdown');
    expect(box).toHaveTextContent(/Shipping & fees waived.*8,000/);
    expect(box).toHaveTextContent(/Discount.*5,000/);
    expect(box).toHaveTextContent(/Total savings.*13,000/);
  });

  it('no goods discount → no Discount row', () => {
    render(
      <DeliveryFeeBreakdown
        {...props}
        requested
        fees={fees({}, { requested: true, applied: true, saving: 1140 })}
        savings={{ discount: 0, deliveryFees: 1140, total: 1140 }}
      />,
    );
    expect(screen.getByTestId('savings-breakdown')).not.toHaveTextContent('Discount');
  });
});
