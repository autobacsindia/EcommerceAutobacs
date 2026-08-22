import React from 'react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import KarmaBadge from './KarmaBadge';
import apiClient from '@/lib/api';
import { profileKeys } from '@/hooks/queries/keys';

jest.mock('@/lib/api');

/**
 * `seed` puts the loyalty payload in the cache BEFORE the first render, so a payload the
 * component can't handle throws synchronously inside `render()` and fails the test.
 * Letting the query resolve asynchronously instead would unmount the tree on throw and
 * leave an empty container — indistinguishable from the "renders nothing" case, which is
 * exactly how the first version of this test passed against the unfixed component.
 */
const renderBadge = (seed?: unknown) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  if (seed !== undefined) queryClient.setQueryData(profileKeys.karma(), seed);
  return render(
    <QueryClientProvider client={queryClient}>
      <span>sibling</span>
      <KarmaBadge />
    </QueryClientProvider>
  );
};

describe('KarmaBadge', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders the balance when loyalty is enabled', async () => {
    renderBadge({ success: true, balance: 250, config: { enabled: true, pointValueInRupees: 1 } });
    expect(await screen.findByText(/250/)).toBeInTheDocument();
  });

  it('survives a 200 whose body is missing `config`', () => {
    // The badge is decoration on a page that matters. A reshaped or partial loyalty
    // response must not throw here — that would take the whole profile page down to the
    // error boundary. Render nothing, and leave the rest of the page standing.
    expect(() => renderBadge({ success: true, balance: 10 })).not.toThrow();
    expect(screen.getByText('sibling')).toBeInTheDocument();
  });

  it('renders nothing when loyalty is switched off', () => {
    renderBadge({ success: true, balance: 250, config: { enabled: false, pointValueInRupees: 1 } });
    expect(screen.queryByText(/250/)).not.toBeInTheDocument();
    expect(screen.getByText('sibling')).toBeInTheDocument();
  });
});
