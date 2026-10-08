import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import VehicleFinder from './VehicleFinder';

const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
jest.mock('@/lib/analytics', () => ({ capture: jest.fn() }));

jest.mock('@/hooks/queries/useVehicleMakes', () => ({
  useVehicleMakes: () => ({ data: [{ _id: 'Toyota', name: 'Toyota', slug: 'toyota' }, { _id: 'Land Rover', name: 'Land Rover', slug: 'land-rover' }] }),
  useVehicleModels: (make: string) => ({
    data: make === 'Toyota' ? ['Fortuner', 'Hilux'] : make === 'Land Rover' ? ['Defender'] : [],
    isFetching: false,
  }),
}));

jest.mock('@/hooks/queries/useCategories', () => ({
  useCategories: () => ({
    data: [
      { _id: '1', name: 'Exterior', slug: 'exterior', parent: null },
      { _id: '2', name: 'Lighting', slug: 'lighting', parent: null },
      { _id: '5', name: 'Audio', slug: 'audio', parent: null },
      { _id: '3', name: 'Spoiler', slug: 'spoiler', parent: '1' },  // child: not a main category
      { _id: '4', name: 'No Slug', parent: null },                  // no page to land on
    ],
  }),
}));

// Parts per category for the chosen vehicle: a Hilux has Exterior and Lighting
// parts but no Audio.
const get = jest.fn();
jest.mock('@/lib/api', () => ({ __esModule: true, default: { get: (...a: unknown[]) => get(...a) } }));

const renderFinder = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <VehicleFinder />
    </QueryClientProvider>,
  );

const searchButton = () => screen.getByRole('button', { name: /search parts/i });
const selects = () => screen.getAllByRole('combobox');
const chooseVehicle = (make: string, model: string) => {
  fireEvent.change(selects()[0], { target: { value: make } });
  fireEvent.change(selects()[1], { target: { value: model } });
};

describe('VehicleFinder', () => {
  beforeEach(() => {
    push.mockReset();
    get.mockReset();
    get.mockResolvedValue({ facets: { categories: [
      { categoryId: '1', count: 65 },
      { categoryId: '2', count: 15 },
      { categoryId: '5', count: 0 },
    ] } });
  });

  it('offers only main categories that have a page', () => {
    renderFinder();
    expect(screen.getAllByRole('radio').map((c) => c.textContent)).toEqual(['Audio', 'Exterior', 'Lighting']);
  });

  it('keeps Search visible but disabled until a model is chosen', () => {
    renderFinder();
    expect(searchButton()).toBeDisabled();
    fireEvent.change(selects()[0], { target: { value: 'Toyota' } });
    expect(searchButton()).toBeDisabled();
    fireEvent.change(selects()[1], { target: { value: 'Hilux' } });
    expect(searchButton()).toBeEnabled();
  });

  it('shows every part for the vehicle when no category is picked', () => {
    renderFinder();
    chooseVehicle('Toyota', 'Hilux');
    fireEvent.click(searchButton());
    expect(push).toHaveBeenCalledWith('/products?vehicleMake=Toyota&vehicleModel=Hilux');
  });

  it('opens a category filtered to the vehicle when one is picked', async () => {
    renderFinder();
    chooseVehicle('Land Rover', 'Defender');
    fireEvent.click(await screen.findByRole('radio', { name: /lighting/i }));
    fireEvent.click(searchButton());
    expect(push).toHaveBeenCalledWith('/categories/lighting?vehicleMake=Land+Rover&vehicleModel=Defender');
  });

  it('hides categories with no parts for the vehicle and shows the counts', async () => {
    renderFinder();
    chooseVehicle('Toyota', 'Hilux');
    await waitFor(() => expect(screen.queryByRole('radio', { name: /audio/i })).not.toBeInTheDocument());
    expect(screen.getByRole('radio', { name: /exterior/i })).toHaveTextContent('65');
    expect(get).toHaveBeenCalledWith('/products/facets?vehicleMake=Toyota&vehicleModel=Hilux');
  });

  it('drops a category picked earlier if the chosen vehicle has no parts in it', async () => {
    renderFinder();
    fireEvent.click(screen.getByRole('radio', { name: 'Audio' }));
    chooseVehicle('Toyota', 'Hilux');
    await waitFor(() => expect(screen.queryByRole('radio', { name: /audio/i })).not.toBeInTheDocument());
    fireEvent.click(searchButton());
    expect(push).toHaveBeenCalledWith('/products?vehicleMake=Toyota&vehicleModel=Hilux');
  });

  it('still shows all categories if the counts cannot be loaded', async () => {
    get.mockRejectedValue(new Error('network'));
    renderFinder();
    chooseVehicle('Toyota', 'Hilux');
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });

  it('clears the model when the make changes', () => {
    renderFinder();
    chooseVehicle('Toyota', 'Hilux');
    fireEvent.change(selects()[0], { target: { value: 'Land Rover' } });
    expect((selects()[1] as HTMLSelectElement).value).toBe('');
    expect(searchButton()).toBeDisabled();
  });

  it('can still search a category alone without a vehicle', () => {
    renderFinder();
    fireEvent.click(screen.getByRole('radio', { name: 'Exterior' }));
    fireEvent.click(searchButton());
    expect(push).toHaveBeenCalledWith('/categories/exterior');
  });
});

describe('VehicleFinder guidance', () => {
  beforeEach(() => { get.mockResolvedValue({ facets: { categories: [] } }); });

  it('shows the three steps and lights them up as the visitor goes', () => {
    renderFinder();
    const steps = screen.getByRole('list', { name: /how it works/i });
    expect(within(steps).getByText(/choose make/i)).toBeInTheDocument();
    expect(within(steps).getByText(/choose model/i)).toBeInTheDocument();
    expect(within(steps).getByText(/pick a category/i)).toBeInTheDocument();
  });

  it('a popular-make shortcut fills the make (only for makes we stock)', () => {
    renderFinder();
    // Toyota and Land Rover are in the mocked catalogue; Mahindra is not.
    expect(screen.queryByRole('button', { name: 'Mahindra' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Toyota' }));
    expect((selects()[0] as HTMLSelectElement).value).toBe('Toyota');
  });
});
