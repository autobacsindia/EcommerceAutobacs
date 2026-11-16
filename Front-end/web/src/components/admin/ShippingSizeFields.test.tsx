import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import ShippingSizeFields from './ShippingSizeFields';
import { EMPTY_SHIPPING_SIZE, type ShippingSizeForm } from '@/lib/shippingSize';
import { EMPTY_LISTED_SIZE, type ListedSizeForm, type ShippingClassChoice } from '@/lib/shippingClass';

function Harness({
  initial = EMPTY_SHIPPING_SIZE,
  listedInitial = EMPTY_LISTED_SIZE,
  classInitial = '',
}: { initial?: ShippingSizeForm; listedInitial?: ListedSizeForm; classInitial?: ShippingClassChoice }) {
  const [v, setV] = useState(initial);
  const [l, setL] = useState(listedInitial);
  const [c, setC] = useState<ShippingClassChoice>(classInitial);
  return <ShippingSizeFields value={v} onChange={setV} listed={l} onListedChange={setL} shippingClass={c} onShippingClassChange={setC} />;
}

const byId = (id: string) => document.getElementById(id) as HTMLInputElement;
const packed = (k: string) => byId(`shippingSize-${k}`);
const online = (k: string) => byId(`listedSize-${k}`);
const classSelect = () => screen.getByLabelText(/size class/i) as HTMLSelectElement;

describe('ShippingSizeFields', () => {
  it('shows a size class dropdown plus blank online and packed sizes', () => {
    render(<Harness />);
    expect(classSelect().value).toBe('');
    expect(screen.getByRole('option', { name: /automatic — not set until a size is entered/i })).toBeInTheDocument();
    for (const k of ['weightKg', 'lengthCm', 'breadthCm', 'heightCm']) {
      expect(packed(k).value).toBe('');
      expect(online(k).value).toBe('');
    }
  });

  it('flags a packed weight typed in grams', () => {
    render(<Harness />);
    fireEvent.change(packed('weightKg'), { target: { value: '2500' } });
    expect(screen.getByText(/typed grams by mistake/i)).toBeInTheDocument();
    expect(packed('weightKg')).toHaveAttribute('aria-invalid', 'true');
  });

  it('warns when the packed box is big for its weight', () => {
    render(<Harness initial={{ weightKg: '18', lengthCm: '190', breadthCm: '80', heightCm: '40' }} />);
    expect(screen.getByText(/charge it as 121.6 kg/i)).toBeInTheDocument();
  });

  it('no warning for a dense item', () => {
    render(<Harness initial={{ weightKg: '15', lengthCm: '25', breadthCm: '18', heightCm: '20' }} />);
    expect(screen.queryByText(/charge it as/i)).toBeNull();
  });

  it('Automatic previews the class from the online size (with packing allowance)', () => {
    render(<Harness />);
    fireEvent.change(online('weightKg'), { target: { value: '0.8' } });
    fireEvent.change(online('lengthCm'), { target: { value: '25' } });
    fireEvent.change(online('breadthCm'), { target: { value: '10' } });
    fireEvent.change(online('heightCm'), { target: { value: '10' } });
    expect(screen.getByRole('option', { name: /automatic — small \(from the size\)/i })).toBeInTheDocument();
  });

  it('a chosen class is kept and the disagreement is shown', () => {
    render(<Harness initial={{ weightKg: '25', lengthCm: '60', breadthCm: '50', heightCm: '40' }} />);
    fireEvent.change(classSelect(), { target: { value: 'small' } });
    expect(classSelect().value).toBe('small');
    expect(screen.getByText(/the size says large\. your choice of small is kept/i)).toBeInTheDocument();
  });

  it('rejects a source link that is not a web address', () => {
    render(<Harness />);
    fireEvent.change(online('sourceUrl'), { target: { value: 'amazon listing' } });
    expect(screen.getByText(/starting with https/i)).toBeInTheDocument();
  });
});
