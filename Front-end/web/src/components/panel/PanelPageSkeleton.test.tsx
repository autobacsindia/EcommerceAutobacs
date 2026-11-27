import { render, screen } from '@testing-library/react';
import AdminLoading from '@/app/admin/loading';
import TeamLoading from '@/app/team/loading';

describe('panel loading skeleton', () => {
  // Regression: staff pages had no loading skeleton, so a click in the team
  // panel left the old page frozen until the server answered.
  it.each([['admin', AdminLoading], ['team', TeamLoading]])('the %s panel shows a skeleton while a page loads', (_name, Loading) => {
    render(<Loading />);
    expect(screen.getByRole('status', { name: 'Loading' })).toHaveAttribute('aria-busy', 'true');
  });
});
