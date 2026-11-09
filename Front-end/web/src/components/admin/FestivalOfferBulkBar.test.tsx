import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import FestivalOfferBulkBar from './FestivalOfferBulkBar';
import apiClient from '@/lib/api';

jest.mock('@/lib/api', () => ({ __esModule: true, default: { patch: jest.fn() } }));
const patch = apiClient.patch as jest.Mock;
beforeEach(() => patch.mockReset());

describe('FestivalOfferBulkBar', () => {
  it('is hidden with nothing selected', () => {
    const { container } = render(<FestivalOfferBulkBar selectedIds={[]} onDone={jest.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('applies to every ticked product and reports the outcome', async () => {
    patch.mockResolvedValue({ success: true, requested: 3, updated: 1, unchanged: 1, notFound: ['x'] });
    const onDone = jest.fn();
    render(<FestivalOfferBulkBar selectedIds={['a', 'b', 'x']} onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(patch).toHaveBeenCalledWith(expect.any(String), { productIds: ['a', 'b', 'x'], mode: 'none' });
    expect(screen.getByRole('status')).toHaveTextContent('1 updated, 1 already set, 1 could not be found');
  });

  it('refuses an invalid custom % without calling the server', () => {
    render(<FestivalOfferBulkBar selectedIds={['a']} onDone={jest.fn()} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'custom' } });
    fireEvent.change(screen.getByLabelText('Custom percentage'), { target: { value: '45' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(patch).not.toHaveBeenCalled();
  });

  it('blocks more than 200', () => {
    render(<FestivalOfferBulkBar selectedIds={Array.from({ length: 201 }, (_, i) => String(i))} onDone={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
  });
});
