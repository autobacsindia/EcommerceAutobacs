/**
 * The coupon form's vehicle scope. The API replaces `appliesTo` whole, so the money
 * risk is a save that drops part of the scope and widens a Hilux-only coupon to the
 * whole store. These cases pin the payload.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import CouponForm, { couponToForm, EMPTY_COUPON } from './CouponForm';
import apiClient from '@/lib/api';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/lib/usePanel', () => ({ usePanel: () => ({ base: '/admin' }) }));
jest.mock('@/lib/api', () => ({ __esModule: true, default: { put: jest.fn(), post: jest.fn() } }));
jest.mock('@/hooks/queries/useVehicleMakes', () => ({
  useAllVehicles: () => ({
    isLoading: false,
    data: [
      { _id: 'v-hilux', make: 'Toyota', model: 'Hilux', slug: 'toyota-hilux' },
      { _id: 'v-travo', make: 'toyota', model: 'hilux travo', slug: 'toyota-hilux-travo' },
      { _id: 'v-thar', make: 'Mahindra', model: 'Thar', slug: 'mahindra-thar' },
    ],
  }),
}));

const HILUX = {
  code: 'HILUX5000', type: 'fixed', value: 5000, minCartValue: 25000, usageLimitPerUser: 1,
  isActive: true, visibility: 'hidden',
  appliesTo: { vehicles: ['v-hilux', { _id: 'v-travo' }], categories: ['c1'], brandSlugs: [], products: [] },
};

beforeEach(() => jest.clearAllMocks());

it('reads the saved vehicles and shows them by name', () => {
  render(<CouponForm initial={couponToForm(HILUX)} couponId="id1" />);
  expect(screen.getByRole('button', { name: 'Remove Toyota Hilux' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Remove toyota hilux travo' })).toBeInTheDocument();
});

it('saving keeps the vehicles and the scope this form does not edit', async () => {
  (apiClient.put as jest.Mock).mockResolvedValue({ success: true });
  render(<CouponForm initial={couponToForm(HILUX)} couponId="id1" />);
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(apiClient.put).toHaveBeenCalled());
  const payload = (apiClient.put as jest.Mock).mock.calls[0][1];
  expect(payload.appliesTo).toEqual({ vehicles: ['v-hilux', 'v-travo'], categories: ['c1'], brandSlugs: [], products: [] });
});

it('ticking a vehicle adds it; a new coupon with none stays whole-store', async () => {
  (apiClient.post as jest.Mock).mockResolvedValue({ success: true });
  render(<CouponForm initial={{ ...EMPTY_COUPON, code: 'X' }} />);
  fireEvent.change(screen.getByPlaceholderText('Search e.g. hilux'), { target: { value: 'thar' } });
  expect(screen.queryByText('Toyota Hilux')).toBeNull();
  fireEvent.click(screen.getByRole('checkbox', { name: /Mahindra Thar/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Create coupon' }));
  await waitFor(() => expect(apiClient.post).toHaveBeenCalled());
  expect((apiClient.post as jest.Mock).mock.calls[0][1].appliesTo.vehicles).toEqual(['v-thar']);
});
