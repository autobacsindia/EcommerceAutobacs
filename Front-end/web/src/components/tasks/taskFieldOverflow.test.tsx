/**
 * A task's people line ("(A)(S) Aromal, Amarnath +3") must stay inside its
 * cell of the details grid. Someone who cannot change who does a task gets the
 * line on its own, not inside the picker button, and without a width limit of
 * its own it spilled over "Estimate" on narrower screens (a 1280px laptop at
 * 125%). jsdom does no layout, so this pins the classes that do the job.
 */
import { render as rtlRender, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PeopleLine } from './TaskDetail';

jest.mock('@/lib/api-client', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() } }));

// The faces read staff photos through react-query.
const render = (ui: React.ReactElement) => rtlRender(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
);

const people = [
  { id: 'a', name: 'Aromal S' },
  { id: 'b', name: 'Amarnath Krishnakumar' },
  { id: 'c', name: 'Sreelakshmi Venugopalan' },
  { id: 'd', name: 'Bhagyalakshmi Ramachandran' },
  { id: 'e', name: 'Christopher Fernandez' },
];

describe('PeopleLine in the task details grid', () => {
  it('is limited to its cell, so it can shrink instead of spilling over', () => {
    render(<PeopleLine people={people} empty="Nobody" />);
    const line = screen.getByTestId('people-line');
    expect(line).toHaveClass('max-w-full', 'min-w-0');
  });

  it('cuts the names with "…" and shows everyone on hover', () => {
    render(<PeopleLine people={people} empty="Nobody" />);
    const names = screen.getByText('Aromal, Amarnath +3');
    expect(names).toHaveClass('truncate', 'min-w-0');
    expect(names).toHaveAttribute('title', people.map((p) => p.name).join(', '));
  });

  it('keeps the faces at full size', () => {
    render(<PeopleLine people={people} empty="Nobody" />);
    const faces = screen.getByRole('img', { name: people.map((p) => p.name).join(', ') });
    expect(faces.parentElement).toHaveClass('shrink-0');
  });

  it('says who is missing when there is nobody', () => {
    render(<PeopleLine people={[]} empty="Nobody" />);
    expect(screen.getByText('Nobody')).toBeInTheDocument();
  });
});
