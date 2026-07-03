import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import CategoryMultiSelect, { type CategoryOption } from './CategoryMultiSelect';

// Taxonomy: Accessories (hub) → [Interior, Exterior]; Audio (hub, no children).
// Plus an orphan whose parent isn't in the list → "Ungrouped".
const categories: CategoryOption[] = [
  { _id: 'acc', name: 'Accessories', parent: null },
  { _id: 'interior', name: 'Interior', parent: { _id: 'acc' } },
  { _id: 'exterior', name: 'Exterior', parent: 'acc' },
  { _id: 'audio', name: 'Audio', parent: null },
  { _id: 'orphan', name: 'Orphan', parent: 'missing-hub' },
];

/** Controlled test harness so we can assert the emitted selection. */
function Harness({ initial = [] as string[] }: { initial?: string[] }) {
  const [selected, setSelected] = React.useState<string[]>(initial);
  return (
    <div>
      <div data-testid="selection">{selected.join(',')}</div>
      <CategoryMultiSelect
        categories={categories}
        selected={selected}
        onChange={setSelected}
      />
    </div>
  );
}

const openDropdown = () => fireEvent.click(screen.getByRole('button', { name: 'Categories' }));
const selection = () => screen.getByTestId('selection').textContent;

describe('CategoryMultiSelect', () => {
  it('groups sub-categories under their hub and buckets orphans as Ungrouped', () => {
    render(<Harness />);
    openDropdown();
    const listbox = screen.getByRole('listbox');

    // Hub + its two children + the standalone hub + orphan are all present.
    expect(within(listbox).getByText('Accessories')).toBeInTheDocument();
    expect(within(listbox).getByText('Interior')).toBeInTheDocument();
    expect(within(listbox).getByText('Exterior')).toBeInTheDocument();
    expect(within(listbox).getByText('Audio')).toBeInTheDocument();
    expect(within(listbox).getByText('Ungrouped')).toBeInTheDocument();
    expect(within(listbox).getByText('Orphan')).toBeInTheDocument();
  });

  it('selecting a sub-category drops its already-selected ancestor hub', () => {
    render(<Harness initial={['acc']} />);
    openDropdown();
    fireEvent.click(screen.getByText('Interior'));
    // Hub replaced by the leaf — never both.
    expect(selection()).toBe('interior');
  });

  it('selecting a hub drops its already-selected descendant subs', () => {
    render(<Harness initial={['interior', 'exterior']} />);
    openDropdown();
    fireEvent.click(screen.getByText('Accessories'));
    expect(selection()).toBe('acc');
  });

  it('keeps unrelated selections when adding one in a different subtree', () => {
    render(<Harness initial={['interior']} />);
    openDropdown();
    fireEvent.click(screen.getByText('Audio'));
    expect(selection()).toBe('interior,audio');
  });

  it('toggles a selected category off when clicked again', () => {
    render(<Harness initial={['audio']} />);
    openDropdown();
    fireEvent.click(within(screen.getByRole('listbox')).getByText('Audio'));
    expect(selection()).toBe('');
  });

  it('renders sub-category chips with their hub context', () => {
    render(<Harness initial={['interior']} />);
    // Chip shows "Accessories › Interior" so identical leaf names stay distinct.
    expect(screen.getByText('Accessories › Interior')).toBeInTheDocument();
  });

  it('filters by search, showing a hub group when a child matches', () => {
    render(<Harness />);
    openDropdown();
    fireEvent.change(screen.getByPlaceholderText(/search categories/i), {
      target: { value: 'interior' },
    });
    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getByText('Interior')).toBeInTheDocument();
    expect(within(listbox).queryByText('Audio')).not.toBeInTheDocument();
  });
});
