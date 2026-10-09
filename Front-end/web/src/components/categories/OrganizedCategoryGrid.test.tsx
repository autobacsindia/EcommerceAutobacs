import { render, screen, within } from '@testing-library/react';
import OrganizedCategoryGrid from './OrganizedCategoryGrid';
import type { Category } from '@/lib/types';

jest.mock('@/components/layout/EnhancedImage', () => ({ __esModule: true, default: (p: { alt: string }) => <img alt={p.alt} /> }));

const cat = (id: string, name: string, parent?: string): Category =>
  ({ _id: id, name, slug: name.toLowerCase().replace(/\s+/g, '-'), parent, isActive: true }) as unknown as Category;

describe('OrganizedCategoryGrid', () => {
  it('shows every live top-level department, A–Z (not a fixed list of four)', () => {
    render(<OrganizedCategoryGrid categories={[cat('w', 'Winch'), cat('a', 'Audio'), cat('b', 'Brakes'), cat('s', 'Speakers', 'a')]} />);
    const grid = screen.getByRole('region', { name: 'All departments' });
    const names = within(grid).getAllByRole('link').map((l) => l.getAttribute('href')).filter((h) => h?.startsWith('/categories/'));
    expect(names).toEqual(['/categories/audio', '/categories/brakes', '/categories/winch']);
  });

  it('lists sub-categories as chips, capping long lists with "+N more"', () => {
    const subs = Array.from({ length: 14 }, (_, i) => cat(`s${i}`, `Sub ${String(i).padStart(2, '0')}`, 'a'));
    render(<OrganizedCategoryGrid categories={[cat('a', 'Audio'), ...subs]} />);
    expect(screen.getByRole('link', { name: 'Sub 00' })).toHaveAttribute('href', '/categories/sub-00');
    expect(screen.queryByRole('link', { name: 'Sub 13' })).toBeNull();
    expect(screen.getByRole('link', { name: '+2 more' })).toHaveAttribute('href', '/categories/audio');
  });
});
