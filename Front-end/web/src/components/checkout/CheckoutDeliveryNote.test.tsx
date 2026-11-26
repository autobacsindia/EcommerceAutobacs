import { render, screen } from '@testing-library/react';
import CheckoutDeliveryNote from './CheckoutDeliveryNote';

it('shows the owner\'s exact wording as a calm note, not an alert', () => {
  render(<CheckoutDeliveryNote />);
  const note = screen.getByRole('note', { name: 'Delivery time' });
  expect(note).toHaveTextContent(
    "We deal in machinery and equipment. General delivery is 7–10 days, up to 15 days for heavy goods. That's not where we aim to be. We keep you in the loop throughout, and we're improving every week to serve you better.",
  );
  expect(screen.queryByRole('alert')).toBeNull();
});
