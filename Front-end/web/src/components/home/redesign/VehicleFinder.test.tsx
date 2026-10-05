import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
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
      { _id: '3', name: 'Spoiler', slug: 'spoiler', parent: '1' },  // child: not a main category
      { _id: '4', name: 'No Slug', parent: null },                  // no page to land on
    ],
  }),
}));

const searchButton = () => screen.getByRole('button', { name: /search parts/i });

describe('VehicleFinder', () => {
  beforeEach(() => push.mockReset());

  it('offers only main categories that have a page', () => {
    render(<VehicleFinder />);
    const chips = screen.getAllByRole('radio').map((c) => c.textContent);
    expect(chips).toEqual(['Exterior', 'Lighting']);
  });

  it('keeps Search visible but disabled until a category is picked', () => {
    render(<VehicleFinder />);
    expect(searchButton()).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: 'Exterior' }));
    expect(searchButton()).toBeEnabled();
  });

  it('unlocks the model list only after a make is chosen', () => {
    render(<VehicleFinder />);
    const [, modelSelect] = screen.getAllByRole('combobox');
    expect(modelSelect).toBeDisabled();
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'Toyota' } });
    expect(screen.getAllByRole('combobox')[1]).toBeEnabled();
  });

  it('opens the category filtered to the chosen vehicle', () => {
    render(<VehicleFinder />);
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'Land Rover' } });
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'Defender' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Lighting' }));
    fireEvent.click(searchButton());
    expect(push).toHaveBeenCalledWith('/categories/lighting?vehicleMake=Land+Rover&vehicleModel=Defender');
  });

  it('clears the model when the make changes', () => {
    render(<VehicleFinder />);
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'Toyota' } });
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'Hilux' } });
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'Land Rover' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Exterior' }));
    fireEvent.click(searchButton());
    expect(push).toHaveBeenCalledWith('/categories/exterior?vehicleMake=Land+Rover');
  });

  it('searches a category alone when no vehicle is chosen', () => {
    render(<VehicleFinder />);
    fireEvent.click(screen.getByRole('radio', { name: 'Exterior' }));
    fireEvent.click(searchButton());
    expect(push).toHaveBeenCalledWith('/categories/exterior');
  });
});
