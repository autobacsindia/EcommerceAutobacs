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
});

it('Black Friday offer → saving line and ₹0 charged; admin sees booking detail', () => {
  render(<OrderDeliveryFees fees={snapshot(true)} shippingCost={0} admin />);
  expect(screen.getByText('Black Friday offer — delivery fees waived').nextSibling).toHaveTextContent('1,390');
  expect(screen.getByText('Delivery fees charged').nextSibling).toHaveTextContent('0');
  expect(screen.getByText(/book as PREPAID/)).toHaveTextContent('Jalpaiguri, West Bengal');
});
