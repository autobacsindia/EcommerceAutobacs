import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import ShippingSizeFields from './ShippingSizeFields';
import { EMPTY_SHIPPING_SIZE, type ShippingSizeForm } from '@/lib/shippingSize';

function Harness({ initial = EMPTY_SHIPPING_SIZE }: { initial?: ShippingSizeForm }) {
  const [v, setV] = useState(initial);
  return <ShippingSizeFields value={v} onChange={setV} />;
}

const field = (name: RegExp) => screen.getByLabelText(name) as HTMLInputElement;

describe('ShippingSizeFields', () => {
  it('shows four labelled, blank fields by default', () => {
    render(<Harness />);
    for (const n of [/weight/i, /length/i, /width/i, /height/i]) expect(field(n).value).toBe('');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('flags a weight typed in grams', () => {
    render(<Harness />);
    fireEvent.change(field(/weight/i), { target: { value: '2500' } });
    expect(screen.getByText(/typed grams by mistake/i)).toBeInTheDocument();
    expect(field(/weight/i)).toHaveAttribute('aria-invalid', 'true');
  });

  it('warns when the box is big for its weight', () => {
    render(<Harness initial={{ weightKg: '18', lengthCm: '190', breadthCm: '80', heightCm: '40' }} />);
    expect(screen.getByText(/charge it as 121.6 kg/i)).toBeInTheDocument();
  });

  it('no warning for a dense item', () => {
    render(<Harness initial={{ weightKg: '15', lengthCm: '25', breadthCm: '18', heightCm: '20' }} />);
    expect(screen.queryByText(/charge it as/i)).toBeNull();
  });
});
