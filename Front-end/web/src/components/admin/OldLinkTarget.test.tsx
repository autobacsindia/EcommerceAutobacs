import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const get = jest.fn();
jest.mock('@/lib/api', () => ({ __esModule: true, default: { get: (...a: unknown[]) => get(...a) } }));

import OldLinkTarget, { modeOf } from './OldLinkTarget';

describe('OldLinkTarget', () => {
  beforeEach(() => get.mockReset());

  it('modeOf reads the stored path', () => {
    expect(modeOf(null)).toBe('default');
    expect(modeOf('/products/x')).toBe('product');
    expect(modeOf('/categories/y')).toBe('category');
  });

  it('a category choice emits /categories/<slug>; the default emits null', async () => {
    get.mockResolvedValue({ categories: [{ slug: 'dash-cams', name: 'Dash Cams' }] });
    const onChange = jest.fn();
    render(<OldLinkTarget value={null} onChange={onChange} defaultLabel="Its own category (automatic)" />);
    fireEvent.click(screen.getByLabelText('A category'));
    await screen.findByRole('option', { name: 'Dash Cams' });
    fireEvent.change(screen.getByLabelText('Category for the old link'), { target: { value: '/categories/dash-cams' } });
    expect(onChange).toHaveBeenLastCalledWith('/categories/dash-cams');
    fireEvent.click(screen.getByLabelText('Its own category (automatic)'));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('product search never offers the product being removed', async () => {
    get.mockResolvedValue({ products: [{ slug: 'self', name: 'Self' }, { slug: 'thor-3', name: 'Thor 3' }] });
    const onChange = jest.fn();
    render(<OldLinkTarget value={null} onChange={onChange} defaultLabel="Default" excludeSlug="self" />);
    fireEvent.click(screen.getByLabelText('A replacement product'));
    fireEvent.change(screen.getByLabelText('Search for the replacement product'), { target: { value: 'thor' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Thor 3' })).toBeTruthy(), { timeout: 2000 });
    expect(screen.queryByRole('button', { name: 'Self' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Thor 3' }));
    expect(onChange).toHaveBeenLastCalledWith('/products/thor-3');
  });
});
