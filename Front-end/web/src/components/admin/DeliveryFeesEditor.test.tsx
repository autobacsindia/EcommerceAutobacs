/**
 * The one delivery-fee editor in its two homes. Admin: everything, switches sent.
 * Procurement (team panel): rates only — the switches are read-only and NEVER sent
 * (the server refuses a non-admin save that names them), and the PIN list is hidden.
 * The editor never prices anything; it sends what was typed and shows the server's card.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DeliveryFeesEditor from './DeliveryFeesEditor';
import apiClient from '@/lib/api';

jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), put: jest.fn(), post: jest.fn() },
}));

const CARD = {
  chargeAtCheckout: true,
  volumetricDivisor: 4500,
  courier: { maxKg: 5, slabKg: 0.5, slabRate: 60 },
  freight: { minimum: 500, docket: 100, otherCharges: 0, fuel: 0, hamaliPerKg: 1 },
  packing: { small: 50, medium: 100, large: 300, xl: 1500 },
  remoteAreaFee: 200,
  paymentFeePercent: 2,
  paymentFeeGstPercent: 18,
  paymentFeeMax: 0,
  xlBox: { weightKg: 60, lengthCm: 208, breadthCm: 70, heightCm: 85 },
  gstOnFees: { enabled: true, percent: 18 },
  origin: { label: 'Delhi', pin: '110001', lat: 28.6139, lng: 77.209 },
  distanceBands: [{ upToKm: 500, ratePerKg: 16, slabRate: null }, { upToKm: null, ratePerKg: 16, slabRate: null }],
  updatedAt: null,
  remotePinCount: 3,
  pinLocationCount: 100,
};

function renderEditor(props: Partial<React.ComponentProps<typeof DeliveryFeesEditor>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DeliveryFeesEditor endpoint="/x" queryKey={['df', 'test']} canEditSwitches showRemotePins {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  (apiClient.get as jest.Mock).mockImplementation((url: string) =>
    Promise.resolve(url === '/x' || url === '/staff' ? { config: CARD } : { pins: [], nextCursor: null }));
  (apiClient.put as jest.Mock).mockImplementation((_url: string, body: { distanceBands: unknown }) =>
    Promise.resolve({ config: { ...CARD, distanceBands: body.distanceBands } }));
});

it('procurement: switches read-only and left out of the save; PIN list hidden; band rates sent', async () => {
  renderEditor({ endpoint: '/staff', canEditSwitches: false, showRemotePins: false });

  const band = await screen.findByLabelText('Band 1 rate per kg');
  expect(screen.getByTestId('charge-at-checkout')).toBeDisabled();
  expect(screen.getByTestId('gst-on-fees')).toBeDisabled();
  expect(screen.getByTestId('switches-admin-only')).toBeInTheDocument();
  expect(screen.queryByText(/Remote area PINs/)).not.toBeInTheDocument();

  fireEvent.change(band, { target: { value: '12' } });
  fireEvent.change(screen.getByLabelText('Band 2 small parcel rate per slab'), { target: { value: '150' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save rates' }));

  await waitFor(() => expect(apiClient.put).toHaveBeenCalledTimes(1));
  const [url, body] = (apiClient.put as jest.Mock).mock.calls[0];
  expect(url).toBe('/staff');
  expect(body).not.toHaveProperty('chargeAtCheckout');
  expect(body.gstOnFees).toEqual({ percent: '18' });
  expect(body.distanceBands).toEqual([
    { upToKm: '500', ratePerKg: '12', slabRate: null },
    { upToKm: null, ratePerKg: '16', slabRate: '150' },
  ]);
  expect(await screen.findByText(/Saved\. Checkout uses the new rates/)).toBeInTheDocument();
  // The remote-PIN list is never fetched from the team panel.
  expect((apiClient.get as jest.Mock).mock.calls.map(([u]) => u)).toEqual(['/staff']);
});

it('admin: switches editable and sent with the rates; PIN list shown', async () => {
  renderEditor();
  const charge = await screen.findByTestId('charge-at-checkout');
  expect(charge).toBeEnabled();
  expect(screen.getByText(/Remote area PINs \(3\)/)).toBeInTheDocument();

  fireEvent.click(charge);
  fireEvent.click(screen.getByRole('button', { name: 'Save rates' }));

  await waitFor(() => expect(apiClient.put).toHaveBeenCalledTimes(1));
  const body = (apiClient.put as jest.Mock).mock.calls[0][1];
  expect(body.chargeAtCheckout).toBe(false);
  expect(body.gstOnFees).toEqual({ enabled: true, percent: '18' });
});

it('shows the server refusal instead of claiming the save worked', async () => {
  (apiClient.put as jest.Mock).mockRejectedValue(new Error('Distance bands: up to 10 bands, km going up'));
  renderEditor({ canEditSwitches: false, showRemotePins: false });
  fireEvent.change(await screen.findByLabelText('Band 1 rate per kg'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save rates' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Distance bands');
  expect(screen.queryByText(/Saved\./)).not.toBeInTheDocument();
});
