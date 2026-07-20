import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RedesignNavSearch from './RedesignNavSearch';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import apiClient from '@/lib/api';

// The component reads the shared QueryClient (suggestion memoization), so tests
// render it inside a provider.
const renderNav = (ui: React.ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

jest.mock('next/navigation', () => ({ useRouter: jest.fn() }));
jest.mock('@/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/analytics', () => ({ trackSearch: jest.fn() }));
jest.mock('@/lib/api', () => ({ __esModule: true, default: { get: jest.fn() } }));

const mockGet = apiClient.get as jest.Mock;

const store: Record<string, string> = {};
const localStorageMock = {
  getItem: jest.fn((k: string) => store[k] ?? null),
  setItem: jest.fn((k: string, v: string) => { store[k] = v; }),
  removeItem: jest.fn((k: string) => { delete store[k]; }),
  clear: jest.fn(() => { for (const k of Object.keys(store)) delete store[k]; }),
};
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

describe('RedesignNavSearch', () => {
  const mockPush = jest.fn();

  beforeEach(() => {
    (useRouter as jest.Mock).mockReturnValue({ push: mockPush });
    (useAuth as jest.Mock).mockReturnValue({ user: null, isAuthenticated: false });
    mockPush.mockClear();
    mockGet.mockReset();
    localStorageMock.clear();
    jest.clearAllMocks();
  });

  it('caps recent searches at 3 even when more are stored', async () => {
    const five = ['a', 'b', 'c', 'd', 'e'].map((term, i) => ({ term, timestamp: i }));
    store['searchHistory_guest_global'] = JSON.stringify(five);

    renderNav(<RedesignNavSearch />);
    fireEvent.focus(screen.getByLabelText('Search'));

    await waitFor(() => expect(screen.getByText('Recent')).toBeInTheDocument());
    // Only the 3 most-recent (first 3 of the stored list) render.
    expect(screen.getByText('a')).toBeInTheDocument();
    expect(screen.getByText('b')).toBeInTheDocument();
    expect(screen.getByText('c')).toBeInTheDocument();
    expect(screen.queryByText('d')).not.toBeInTheDocument();
    expect(screen.queryByText('e')).not.toBeInTheDocument();
  });

  it('persists at most 3 recent searches after a new search', async () => {
    store['searchHistory_guest_global'] = JSON.stringify(
      ['a', 'b', 'c'].map((term, i) => ({ term, timestamp: i })),
    );

    renderNav(<RedesignNavSearch />);
    const input = screen.getByLabelText('Search') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'brakes' } });
    fireEvent.submit(input.closest('form')!);

    expect(mockPush).toHaveBeenCalledWith('/products/search?q=brakes');
    // The newest term is prepended and the list is capped back to 3.
    const lastWrite = localStorageMock.setItem.mock.calls.at(-1)!;
    const saved = JSON.parse(lastWrite[1]) as Array<{ term: string }>;
    expect(saved).toHaveLength(3);
    expect(saved[0].term).toBe('brakes');
  });

  it('fetches and shows live suggestions as the user types', async () => {
    mockGet.mockResolvedValue({
      success: true,
      suggestions: [{ id: 'p1', text: 'Bumper Guard', type: 'product', slug: 'bumper-guard' }],
    });

    renderNav(<RedesignNavSearch />);
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'bum' } });

    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining('/products/suggestions?q=bum'),
        expect.objectContaining({ signal: expect.anything() }),
      ),
    );
    expect(await screen.findByText('Bumper Guard')).toBeInTheDocument();
  });

  it('does not query the backend for a single character', async () => {
    renderNav(<RedesignNavSearch />);
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'b' } });
    // Give any debounce a chance to (not) fire.
    await new Promise((r) => setTimeout(r, 300));
    expect(mockGet).not.toHaveBeenCalled();
  });
});
