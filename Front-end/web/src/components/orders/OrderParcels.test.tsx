import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import OrderParcels from './OrderParcels';
import apiClient from '@/lib/api';

jest.mock('@/lib/api');

const mockGet = apiClient.get as jest.Mock;

const parcel = (over: Record<string, unknown> = {}) => ({
  _id: 's1', sequence: 1, status: 'shipped', includesReward: false,
  lines: [{ itemId: 'a', quantity: 2 }],
  trackingNumber: 'AWB-1', carrier: { name: 'Delhivery', trackingUrl: 'http://t/1' },
  ...over,
});

const summary = (over: Record<string, unknown> = {}) => ({
  totalUnits: 3, shippedUnits: 2, parcelCount: 2,
  owesGoodie: false, rewardShipped: true,
  fullyShipped: false, fullyDelivered: false, partial: true,
  label: 'Partially shipped · 2 of 3 items',
  ...over,
});

const renderPanel = (payload: Record<string, unknown>) => {
  mockGet.mockResolvedValue({ shipments: [], remaining: [], summary: summary(), ...payload });
  return render(
    <OrderParcels
      orderId="order-1"
      itemNames={{ a: 'Ceramic Wax', b: 'Polish' }}
      rewardName="Microfibre Cloth"
      cardClass="card"
    />,
  );
};

describe('OrderParcels', () => {
  beforeEach(() => jest.clearAllMocks());

  /*
    The self-hiding rule. A single-parcel order already has a tracking panel that says
    everything there is to say; a "Parcel 1 of 1" card would be pure noise on the
    overwhelming majority of orders.
  */
  it('renders nothing for a single-parcel order', async () => {
    const { container } = renderPanel({ shipments: [parcel()] });
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the order has not shipped at all', async () => {
    const { container } = renderPanel({ shipments: [] });
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a card per parcel once an order splits', async () => {
    renderPanel({
      shipments: [
        parcel(),
        parcel({ _id: 's2', sequence: 2, status: 'packed', lines: [{ itemId: 'b', quantity: 1 }], trackingNumber: 'AWB-2' }),
      ],
    });
    expect(await screen.findByText('Parcel 1 of 2')).toBeInTheDocument();
    expect(screen.getByText('Parcel 2 of 2')).toBeInTheDocument();
  });

  // Raw ObjectIds would be meaningless to a customer; the name mapping is the whole
  // point of passing itemNames in.
  it('names the contents of each parcel', async () => {
    renderPanel({
      shipments: [parcel(), parcel({ _id: 's2', sequence: 2, lines: [{ itemId: 'b', quantity: 1 }] })],
    });
    expect(await screen.findByText('Ceramic Wax × 2')).toBeInTheDocument();
    expect(screen.getByText('Polish × 1')).toBeInTheDocument();
  });

  it('labels the parcel carrying the won goodie', async () => {
    renderPanel({
      shipments: [
        parcel(),
        parcel({ _id: 's2', sequence: 2, includesReward: true, lines: [{ itemId: 'b', quantity: 1 }] }),
      ],
      summary: summary({ owesGoodie: true, rewardShipped: true }),
    });
    expect(await screen.findByText('🎁 Microfibre Cloth × 1')).toBeInTheDocument();
  });

  /*
    Without this block a customer counts the parcels, finds an item in none of them, and
    contacts support. It is the single most valuable thing on this panel.
  */
  it('lists what has not been shipped yet', async () => {
    renderPanel({
      shipments: [parcel(), parcel({ _id: 's2', sequence: 2, lines: [] })],
      remaining: [{ itemId: 'b', name: 'Polish', quantity: 1 }],
    });
    expect(await screen.findByText('Not shipped yet')).toBeInTheDocument();
    expect(screen.getByText('Polish × 1')).toBeInTheDocument();
  });

  it('lists an unshipped goodie as still to come', async () => {
    renderPanel({
      shipments: [parcel(), parcel({ _id: 's2', sequence: 2, lines: [{ itemId: 'b', quantity: 1 }] })],
      summary: summary({ owesGoodie: true, rewardShipped: false }),
    });
    expect(await screen.findByText('Not shipped yet')).toBeInTheDocument();
    expect(screen.getByText('🎁 Microfibre Cloth × 1')).toBeInTheDocument();
  });

  it('hides a lost parcel — it is not one of the boxes coming', async () => {
    renderPanel({
      shipments: [
        parcel(),
        parcel({ _id: 's2', sequence: 2, status: 'lost', lines: [{ itemId: 'b', quantity: 1 }] }),
      ],
    });
    // Only one live parcel left → below the two-parcel threshold, so nothing renders.
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(screen.queryByText(/Parcel 1 of/)).not.toBeInTheDocument();
  });

  // This panel is additive. A failed fulfilment lookup must never take down the order
  // page it sits on.
  it('stays silent when the lookup fails', async () => {
    mockGet.mockRejectedValue(new Error('boom'));
    const { container } = render(
      <OrderParcels orderId="order-1" itemNames={{}} cardClass="card" />,
    );
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
