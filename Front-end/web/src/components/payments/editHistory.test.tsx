/**
 * The "Edited after submit" box is one amber line by default (owner, 2026-11-24:
 * procurement found the full list cluttered). The full history is one click away
 * and is never trimmed.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import EditHistory from './EditHistory';
import { formatDateTimeIST } from '@/lib/datetime';
import type { PaymentEdit } from './api';

const edits: PaymentEdit[] = [
  { at: '2026-11-24T06:10:00Z', byName: 'Omar', role: 'procurement', reason: 'Wrong bill attached', fromStatus: 'submitted',
    changes: [{ field: 'Amount', from: '₹12,000', to: '₹11,500' }] },
  { at: '2026-11-24T08:01:00Z', byName: 'Shyamnadh', role: 'procurement', reason: 'Supplier gave a discount', fromStatus: 'on_hold',
    changes: [{ field: 'Details', from: '20 floor mats', to: '18 floor mats' }] },
] as PaymentEdit[];

describe('EditHistory (collapsed)', () => {
  it('starts collapsed: count, last editor and time on one line, no old values shown', () => {
    render(<EditHistory edits={edits} />);
    const box = screen.getByRole('region', { name: 'Edit history' });
    expect(within(box).getByText('Edited 2 times after submit')).toBeInTheDocument();
    expect(box).toHaveTextContent(`last by Shyamnadh, ${formatDateTimeIST('2026-11-24T08:01:00Z')}`);
    expect(within(box).getByRole('button', { name: 'Show changes' })).toHaveAttribute('aria-expanded', 'false');
    expect(within(box).queryByText('₹12,000')).toBeNull();
    expect(within(box).queryByText(/Supplier gave a discount/)).toBeNull();
  });

  it('expands to the full history, newest first, and collapses again', () => {
    render(<EditHistory edits={edits} />);
    const box = screen.getByRole('region', { name: 'Edit history' });
    fireEvent.click(within(box).getByRole('button', { name: 'Show changes' }));
    expect(within(box).getByRole('button', { name: 'Hide changes' })).toHaveAttribute('aria-expanded', 'true');
    const items = within(box).getAllByRole('listitem').filter((li) => li.parentElement?.tagName === 'OL');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent(/Supplier gave a discount/);
    expect(items[0]).toHaveTextContent(/was on hold, sent back to accounts/);
    expect(items[1]).toHaveTextContent(/Wrong bill attached/);
    expect(within(box).getByText('₹12,000')).toHaveClass('line-through');
    fireEvent.click(within(box).getByRole('button', { name: 'Hide changes' }));
    expect(within(box).queryByText('₹12,000')).toBeNull();
  });

  it('one edit says "1 time"; a missing name says "someone"; no edits shows nothing', () => {
    const { container, rerender } = render(<EditHistory edits={[{ ...edits[0], byName: '' }]} />);
    expect(screen.getByText('Edited 1 time after submit')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Edit history' })).toHaveTextContent('last by someone,');
    rerender(<EditHistory edits={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
