import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import OrderShipments from './OrderShipments';
import apiClient from '@/lib/api';

jest.mock('@/lib/api');
jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { success: jest.fn(), error: jest.fn() },
}));

const mockGet = apiClient.get as jest.Mock;
const mockPost = apiClient.post as jest.Mock;
const mockPatch = apiClient.patch as jest.Mock;

const summary = (over: Record<string, unknown> = {}) => ({
  totalUnits: 3, shippedUnits: 0, deliveredUnits: 0, parcelCount: 0,
  owesGoodie: false, rewardShipped: true,
  fullyShipped: false, fullyDelivered: false, partial: false,
  label: 'Preparing',
  ...over,
});

const seed = (payload: Record<string, unknown> = {}) => {
  mockGet.mockImplementation((url: string) =>
    url.includes('/carriers')
      ? Promise.resolve({ carriers: [{ name: 'Delhivery', code: 'DELHIVERY' }] })
      : Promise.resolve({
          shipments: [],
          remaining: [{ itemId: 'a', name: 'Ceramic Wax', quantity: 2 }],
          summary: summary(),
          ...payload,
        }));
};

const renderPanel = () =>
  render(
    <OrderShipments
      orderId="order-1"
      itemNames={{ a: 'Ceramic Wax', b: 'Polish' }}
      rewardName="Microfibre Cloth"
    />,
  );

describe('OrderShipments', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows the derived fulfilment label rather than inventing a status', async () => {
    seed({ summary: summary({ label: 'Partially shipped · 1 of 3 items', partial: true }) });
    renderPanel();
    expect(await screen.findByText('Partially shipped · 1 of 3 items')).toBeInTheDocument();
  });

  it('lists each parcel with its contents and courier', async () => {
    seed({
      shipments: [{
        _id: 's1', sequence: 1, status: 'shipped', includesReward: false,
        lines: [{ itemId: 'a', quantity: 2 }],
        trackingNumber: 'AWB-1', carrier: { name: 'Delhivery', trackingUrl: 'http://t/1' },
      }],
      remaining: [],
    });
    renderPanel();
    expect(await screen.findByText('Parcel 1')).toBeInTheDocument();
    expect(screen.getByText('Ceramic Wax × 2')).toBeInTheDocument();
    expect(screen.getByText('AWB-1')).toBeInTheDocument();
  });

  /*
    The goodie warning is the replacement for the old "don't forget the goodie" banner:
    an unpacked gift is what stops the order ever reaching `delivered`, so an admin has
    to be able to see it at a glance.
  */
  it('warns while the won goodie is not in any parcel', async () => {
    seed({ summary: summary({ owesGoodie: true, rewardShipped: false }) });
    renderPanel();
    expect(await screen.findByText('Goodie not yet in a parcel')).toBeInTheDocument();
  });

  it('does not warn once the goodie is in a parcel', async () => {
    seed({ summary: summary({ owesGoodie: true, rewardShipped: true }) });
    renderPanel();
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(screen.queryByText('Goodie not yet in a parcel')).not.toBeInTheDocument();
  });

  it('offers Mark delivered only for a parcel actually in transit', async () => {
    seed({
      shipments: [
        { _id: 's1', sequence: 1, status: 'shipped', includesReward: false, lines: [{ itemId: 'a', quantity: 1 }] },
        { _id: 's2', sequence: 2, status: 'delivered', includesReward: false, lines: [{ itemId: 'b', quantity: 1 }] },
      ],
      remaining: [],
    });
    renderPanel();
    await screen.findByText('Parcel 1');
    // Exactly one button: the delivered parcel has nothing left to confirm.
    expect(screen.getAllByRole('button', { name: /Mark delivered/i })).toHaveLength(1);
  });

  it('marks a parcel delivered and refetches', async () => {
    seed({
      shipments: [{ _id: 's1', sequence: 1, status: 'shipped', includesReward: false, lines: [{ itemId: 'a', quantity: 2 }] }],
      remaining: [],
    });
    mockPatch.mockResolvedValue({ success: true });
    const onChanged = jest.fn();
    render(<OrderShipments orderId="order-1" itemNames={{ a: 'Ceramic Wax' }} onChanged={onChanged} />);

    fireEvent.click(await screen.findByRole('button', { name: /Mark delivered/i }));

    await waitFor(() =>
      expect(mockPatch).toHaveBeenCalledWith('/orders/order-1/shipments/s1/delivered', {}));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('creates a parcel from the outstanding lines', async () => {
    seed();
    mockPost.mockResolvedValue({ success: true });
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: /New parcel/i }));
    // Quantities default to everything left, so the common case is one click away.
    fireEvent.change(await screen.findByDisplayValue('2'), { target: { value: '1' } });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'DELHIVERY' } });
    fireEvent.change(
      screen.getByLabelText(/Tracking number/i, { selector: 'input' }),
      { target: { value: 'AWB-NEW' } });
    fireEvent.click(screen.getByRole('button', { name: /Create parcel/i }));

    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith('/orders/order-1/shipments', expect.objectContaining({
        lines: [{ itemId: 'a', quantity: 1 }],
        trackingNumber: 'AWB-NEW',
        carrierCode: 'DELHIVERY',
      })));
  });

  // Server-side is the authority on over-shipping, but there is no reason to let
  // someone type 99 and only discover it after a round trip.
  it('clamps a quantity to what is actually left', async () => {
    seed();
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /New parcel/i }));
    const qty = await screen.findByDisplayValue('2');
    fireEvent.change(qty, { target: { value: '99' } });
    expect((qty as HTMLInputElement).value).toBe('2');
  });

  it('renders nothing for an order with no parcels and nothing to ship', async () => {
    seed({ remaining: [], shipments: [] });
    const { container } = renderPanel();
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});

/**
 * Picking "Shipped" from the order's status dropdown routes here instead of flipping the
 * whole order, because that one-click path ships every outstanding unit in a single box —
 * only ever right by accident on a multi-item order.
 */
describe('opening from the status dropdown', () => {
  beforeEach(() => jest.clearAllMocks());

  it('opens the create-parcel form when the signal fires', async () => {
    seed();
    const { rerender } = render(
      <OrderShipments orderId="order-1" itemNames={{ a: 'Ceramic Wax' }} openFormSignal={0} />);
    await screen.findByText('Preparing');
    expect(screen.queryByRole('button', { name: /Create parcel/i })).not.toBeInTheDocument();

    rerender(<OrderShipments orderId="order-1" itemNames={{ a: 'Ceramic Wax' }} openFormSignal={1} />);
    expect(await screen.findByRole('button', { name: /Create parcel/i })).toBeInTheDocument();
  });

  // A counter, not a boolean: a boolean would latch true, so closing the form and picking
  // "Shipped" again would do nothing at all.
  it('re-opens on a second signal after the form was closed', async () => {
    seed();
    const props = { orderId: 'order-1', itemNames: { a: 'Ceramic Wax' } };
    const { rerender } = render(<OrderShipments {...props} openFormSignal={1} />);
    await screen.findByRole('button', { name: /Create parcel/i });

    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(screen.queryByRole('button', { name: /Create parcel/i })).not.toBeInTheDocument();

    rerender(<OrderShipments {...props} openFormSignal={2} />);
    expect(await screen.findByRole('button', { name: /Create parcel/i })).toBeInTheDocument();
  });

  /*
    ── THE SIGNAL IS ONE-SHOT PER PICK ──────────────────────────────────────────────
    The open-condition also depends on `remaining`, which CHANGES every time a parcel is
    created. A plain `openFormSignal > 0` test re-fired on that change, so on a partially
    shipped order the form re-opened itself the moment `handleCreate` closed it and
    reloaded — with nobody asking for a second parcel.

    Latching in the parent cannot catch this: the signal never changes, it is this
    effect re-running. So the panel has to record which signal it has consumed.
  */
  it('does not re-open itself when creating a parcel changes what is remaining', async () => {
    /*
      TWO outstanding lines, one of which ships completely. The effect's dep is
      `remaining.LENGTH`, so shipping part of a single line would not re-trigger it —
      the remainder has to lose a line for the old condition to re-fire. Getting this
      fixture wrong makes the test pass against the bug.
    */
    seed({
      remaining: [
        { itemId: 'a', name: 'Ceramic Wax', quantity: 1 },
        { itemId: 'b', name: 'Polish', quantity: 1 },
      ],
    });
    mockPost.mockResolvedValue({ success: true, message: 'Parcel 1 created' });

    render(
      <OrderShipments
        orderId="order-1"
        itemNames={{ a: 'Ceramic Wax', b: 'Polish' }}
        openFormSignal={1}
      />);
    await screen.findByRole('button', { name: /Create parcel/i });

    // The reload after a successful create returns one FEWER line: 2 → 1.
    seed({ remaining: [{ itemId: 'b', name: 'Polish', quantity: 1 }] });
    fireEvent.change(screen.getByLabelText('Tracking number'), { target: { value: 'AWB1' } });
    fireEvent.change(screen.getByLabelText('Courier'), { target: { value: 'DELHIVERY' } });
    fireEvent.click(screen.getByRole('button', { name: /Create parcel/i }));

    await waitFor(() => expect(mockPost).toHaveBeenCalled());

    /*
      ⚠️ Assert the SETTLED state, not the first moment the form is gone.

      `handleCreate` closes the form and only THEN reloads, so there is a window where the
      form is legitimately absent before the reload's new `remaining` re-triggers the open
      effect. A bare `waitFor(...not.toBeInTheDocument())` passes on that window and is
      green against the bug. Waiting for the reload to land first is what makes this test
      able to fail.
    */
    const reloads = () => mockGet.mock.calls.filter(([u]: [string]) => !String(u).includes('/carriers'));
    await waitFor(() => expect(reloads().length).toBeGreaterThanOrEqual(2));
    await act(async () => { await Promise.resolve(); });

    expect(screen.queryByRole('button', { name: /Create parcel/i })).not.toBeInTheDocument();
  });

  // An empty picker on a fully-shipped order looks broken rather than informative.
  it('does not open when there is nothing left to ship', async () => {
    seed({ remaining: [], shipments: [], summary: summary({ owesGoodie: false }) });
    render(<OrderShipments orderId="order-1" itemNames={{}} openFormSignal={1} />);
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Create parcel/i })).not.toBeInTheDocument();
  });
});
