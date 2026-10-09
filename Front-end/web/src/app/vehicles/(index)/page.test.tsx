import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import VehiclesPage from './page';

jest.mock('@/services/vehicleService', () => ({
  vehicleService: {
    getAllVehicles: jest.fn().mockResolvedValue([
      { _id: '1', make: 'Toyota', model: 'Fortuner', slug: 'toyota-fortuner', image: { url: '/images/vehicles/toyota-fortuner.jpg', alt: 'Fortuner' } },
      { _id: '2', make: 'Toyota', model: 'Camry', slug: 'toyota-camry' },
      { _id: '3', make: 'Land Rover', model: 'Defender', slug: 'land-rover-defender' },
    ]),
  },
}));

describe('/vehicles', () => {
  it('groups vehicles by make, A–Z, with a link per model', async () => {
    render(<VehiclesPage />);
    const toyota = await screen.findByRole('region', { name: 'Toyota' });
    const models = within(toyota).getAllByRole('link').filter((a) => a.getAttribute('href')?.startsWith('/model/'));
    expect(models.map((a) => a.getAttribute('href'))).toEqual(['/model/toyota-camry', '/model/toyota-fortuner']);
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['Land Rover', 'Toyota']);
  });

  it('"All <make> parts" opens the product list filtered by that make', async () => {
    render(<VehiclesPage />);
    const link = await screen.findByRole('link', { name: /All Land Rover parts/ });
    expect(link).toHaveAttribute('href', '/products?vehicleMake=Land+Rover');
  });

  it('a car with no photo gets the placeholder, not a broken image', async () => {
    render(<VehiclesPage />);
    expect(await screen.findByRole('img', { name: 'Toyota Camry' })).toHaveClass('sp-vph');
  });

  it('the make chips and the search box narrow the list', async () => {
    render(<VehiclesPage />);
    fireEvent.click(await screen.findByRole('button', { name: /^Land Rover/ }));
    expect(screen.queryByRole('region', { name: 'Toyota' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'All makes' }));
    fireEvent.change(screen.getByLabelText('Find your vehicle'), { target: { value: 'camry' } });
    await waitFor(() => expect(screen.queryByRole('link', { name: /Fortuner/ })).toBeNull());
    expect(screen.getByRole('link', { name: /Camry/ })).toBeInTheDocument();
  });

  it('says so — with a way out — when nothing matches', async () => {
    render(<VehiclesPage />);
    fireEvent.change(await screen.findByLabelText('Find your vehicle'), { target: { value: 'zzz' } });
    expect(screen.getByText('No vehicle matches that')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ask a specialist' })).toHaveAttribute('href', '/consultation');
  });
});
