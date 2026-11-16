import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ShippingClassBulkBar from './ShippingClassBulkBar';
import apiClient from '@/lib/api';

jest.mock('@/lib/api', () => ({ __esModule: true, default: { patch: jest.fn() } }));
const patch = apiClient.patch as jest.Mock;
beforeEach(() => patch.mockReset());

describe('ShippingClassBulkBar', () => {
  it('is hidden with nothing selected', () => {
    const { container } = render(<ShippingClassBulkBar selectedIds={[]} onDone={jest.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('sends the chosen class for every ticked product and reports the outcome', async () => {
    patch.mockResolvedValue({ requested: 3, updated: 2, unchanged: 0, notFound: ['x'] });
    const onDone = jest.fn();
    render(<ShippingClassBulkBar selectedIds={['a', 'b', 'x']} onDone={onDone} />);
    fireEvent.change(screen.getByLabelText('Size class to set'), { target: { value: 'large' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set size class' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(patch).toHaveBeenCalledWith('/products/shipping-class', { productIds: ['a', 'b', 'x'], shippingClass: 'large' });
    expect(screen.getByRole('status')).toHaveTextContent('2 updated, 1 could not be found');
  });

  it('can set Automatic', async () => {
    patch.mockResolvedValue({ requested: 1, updated: 1, unchanged: 0, notFound: [] });
    render(<ShippingClassBulkBar selectedIds={['a']} onDone={jest.fn()} />);
    fireEvent.change(screen.getByLabelText('Size class to set'), { target: { value: 'auto' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set size class' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/products/shipping-class', { productIds: ['a'], shippingClass: 'auto' }));
  });

  it('blocks more than 200 at once', () => {
    render(<ShippingClassBulkBar selectedIds={Array.from({ length: 201 }, (_, i) => String(i))} onDone={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Set size class' })).toBeDisabled();
  });

  it('shows the server error and keeps the selection', async () => {
    patch.mockRejectedValue(new Error('Choose at most 200 products at a time'));
    const onDone = jest.fn();
    render(<ShippingClassBulkBar selectedIds={['a']} onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Set size class' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Choose at most 200'));
    expect(onDone).not.toHaveBeenCalled();
  });
});
