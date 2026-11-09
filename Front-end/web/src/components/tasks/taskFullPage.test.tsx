import { render, screen } from '@testing-library/react';
import TeamTaskPage from '@/app/team/tasks/[id]/page';
import AdminTaskPage from '@/app/admin/tasks/[id]/page';

jest.mock('next/navigation', () => ({ useParams: () => ({ id: 't1' }) }));
jest.mock('@/components/tasks/TaskDetail', () => ({
  __esModule: true,
  default: ({ base }: { base: string }) => <div data-testid="detail">{base}</div>,
}));

describe('the expanded task page', () => {
  it.each([
    ['team', TeamTaskPage, '/team/tasks'],
    ['admin', AdminTaskPage, '/admin/tasks'],
  ])('%s panel: fills the width instead of a narrow centred card', (_panel, Page, base) => {
    render(<Page />);
    const detail = screen.getByTestId('detail');
    expect(detail).toHaveTextContent(base);
    expect(detail.parentElement?.className).not.toMatch(/max-w-|mx-auto/);
  });
});
