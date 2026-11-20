import { render, screen } from '@testing-library/react';
import OrderDeliveryFees from './OrderDeliveryFees';

const snapshot = (applied: boolean) => ({
  pin: '735101', remote: true, distanceKm: 1180, place: { district: 'Jalpaiguri', state: 'West Bengal' },
  band: { upToKm: 1500, ratePerKg: 16 }, mode: 'freight' as const, chargedKg: 40, estimated: false,
  lines: [{ code: 'shipping', label: 'Shipping fee', amount: 640 }, { code: 'remote', label: 'Remote area fee', amount: 750 }],
  total: 1390, charged: applied ? 0 : 1390,
  offer: { code: 'blackfriday', applied, saving: applied ? 1390 : 0 },
});

it('older orders keep the single Shipping row', () => {
  render(<OrderDeliveryFees fees={undefined} shippingCost={0} />);
  expect(screen.getByText('Extra — paid on delivery')).toBeInTheDocument();
});

it('lists the snapshot fees and what was charged', () => {
  render(<OrderDeliveryFees fees={snapshot(false)} shippingCost={1390} />);
  expect(screen.getByText('Remote area fee')).toBeInTheDocument();
  expect(screen.getByText('Delivery fees charged').nextSibling).toHaveTextContent('1,390');
  // No offer: payable lines, nothing struck, no Black Friday wording.
  expect(document.querySelectorAll('s, .line-through')).toHaveLength(0);
  expect(screen.queryByText(/Black Friday|You saved/)).not.toBeInTheDocument();
});

it('Black Friday offer → saving line and ₹0 charged; admin sees booking detail', () => {
  render(<OrderDeliveryFees fees={snapshot(true)} shippingCost={0} admin />);
  // Older BF order (no savings snapshot): just the fee saving as the total.
  expect(screen.getByTestId('order-savings')).toHaveTextContent(/Total savings\s*₹?1,390/);
  // Every fee: full price struck through, then ₹0 (Black Friday offer).
  expect(screen.getAllByText(/\(Black Friday offer\)/)).toHaveLength(2);
  const struck = Array.from(document.querySelectorAll('s')).map((n) => n.textContent);
  expect(struck).toEqual([expect.stringContaining('640'), expect.stringContaining('750')]);
  expect(screen.getByText('Delivery fees charged').nextSibling).toHaveTextContent('0');
  expect(screen.getByText(/book as PREPAID/)).toHaveTextContent('Jalpaiguri, West Bengal');
});

it('Black Friday order with the savings snapshot → fees waived · discount · total, as stored', () => {
  render(
    <OrderDeliveryFees
      fees={snapshot(true)}
      shippingCost={0}
      savings={{ discount: 5000, deliveryFees: 1390, total: 6390 }}
    />,
  );
  const box = screen.getByTestId('order-savings');
  expect(box).toHaveTextContent(/Shipping & fees waived\s*₹?1,390/);
  expect(box).toHaveTextContent(/Discount\s*₹?5,000/);
  expect(box).toHaveTextContent(/Total savings\s*₹?6,390/);
});

it('an old order that carried insurance still shows it, as charged', () => {
  const old = { ...snapshot(false), lines: [...snapshot(false).lines, { code: 'insurance', label: 'Insurance fee', amount: 10 }], total: 1400, charged: 1400 };
  render(<OrderDeliveryFees fees={old} shippingCost={1400} />);
  expect(screen.getByText('Insurance fee')).toBeInTheDocument();
  expect(screen.getByText('Delivery fees charged').nextSibling).toHaveTextContent('1,400');
});
