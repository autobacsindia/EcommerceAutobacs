import { fireEvent, render, screen } from '@testing-library/react';
import VehicleImage from './VehicleImage';

describe('VehicleImage', () => {
  it('shows the branded placeholder, not a broken image, when there is no photo', () => {
    render(<VehicleImage src={undefined} alt="Audi A4" make="Audi" />);
    expect(screen.getByRole('img', { name: 'Audi A4' })).toHaveClass('sp-vph');
    expect(screen.getByText('Audi')).toBeInTheDocument();
    expect(screen.getByText('Photo coming soon')).toBeInTheDocument();
  });

  it('swaps to the placeholder when the photo fails to load', () => {
    const { container } = render(<VehicleImage src="/images/vehicles/missing.jpg" alt="Honda City" make="Honda" />);
    const img = container.querySelector('img')!;
    expect(img).toHaveAttribute('src', '/images/vehicles/missing.jpg');
    fireEvent.error(img);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('img', { name: 'Honda City' })).toHaveClass('sp-vph');
  });

  it('renders a real photo lazily', () => {
    const { container } = render(<VehicleImage src="/images/vehicles/audi-q7.jpg" alt="Audi Q7" />);
    expect(container.querySelector('img')).toHaveAttribute('loading', 'lazy');
  });

  describe('R2 photos', () => {
    const R2 = 'https://img.autobacsindia.com';
    const SRC = `${R2}/autobacs/vehicles/thar.jpg`;
    beforeEach(() => { process.env.NEXT_PUBLIC_IMAGE_BASE_URL = R2; });

    it('serves small variants instead of the original', () => {
      const { container } = render(<VehicleImage src={SRC} alt="Thar" />);
      expect(container.querySelector('img')!.getAttribute('srcset'))
        .toContain(`${R2}/variants/autobacs/vehicles/thar/w384 384w`);
    });

    it('a missing variant falls back to the original before giving up', () => {
      const { container } = render(<VehicleImage src={SRC} alt="Thar" make="Mahindra" />);
      fireEvent.error(container.querySelector('img')!);
      const img = container.querySelector('img');
      expect(img).not.toBeNull();
      expect(img!.getAttribute('srcset')).toBeNull();
      expect(img).toHaveAttribute('src', SRC);
      fireEvent.error(img!);
      expect(container.querySelector('img')).toBeNull();
      expect(screen.getByText('Photo coming soon')).toBeInTheDocument();
    });
  });
});
