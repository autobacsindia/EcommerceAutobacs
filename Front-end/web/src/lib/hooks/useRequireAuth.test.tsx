import React from 'react';
import { render, act } from '@testing-library/react';
import { useRequireAuth } from './useRequireAuth';
import { useAuth } from '@/context/AuthContext';

jest.mock('@/context/AuthContext');

const mockReplace = jest.fn();
const mockPush = jest.fn();
let mockPathname = '/profile';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
  usePathname: () => mockPathname,
}));

/** Renders the hook and exposes `releaseGuard` to the test. */
function Harness({ onReady }: { onReady?: (release: () => void) => void }) {
  const { releaseGuard } = useRequireAuth();
  onReady?.(releaseGuard);
  return <div>protected</div>;
}

const setAuth = (state: { isAuthenticated: boolean; isLoading: boolean }) => {
  (useAuth as jest.Mock).mockReturnValue(state);
};

/**
 * Drive jsdom's real `window.location.search` through history — the hook reads the query
 * string off `window` rather than `useSearchParams()`, so the test has to move the same
 * thing the browser would. `location` itself is not redefinable in jsdom.
 */
const setLocation = (search: string) => {
  window.history.replaceState({}, '', `/${search}`);
};

describe('useRequireAuth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPathname = '/profile';
    setLocation('');
  });

  it('sends a signed-out visitor to login carrying where they were headed', () => {
    setAuth({ isAuthenticated: false, isLoading: false });
    render(<Harness />);
    expect(mockReplace).toHaveBeenCalledWith('/login?redirect=%2Fprofile');
  });

  it('preserves the query string, so a filtered view survives the round-trip', () => {
    setAuth({ isAuthenticated: false, isLoading: false });
    mockPathname = '/orders';
    setLocation('?status=delivered');
    render(<Harness />);
    expect(mockReplace).toHaveBeenCalledWith('/login?redirect=%2Forders%3Fstatus%3Ddelivered');
  });

  it('replaces rather than pushes, so Back cannot land on a page that re-bounces', () => {
    setAuth({ isAuthenticated: false, isLoading: false });
    render(<Harness />);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('waits for auth to resolve before bouncing anyone', () => {
    // The pre-hydration state is "not authenticated yet" — bouncing here would throw
    // signed-in customers at the login screen on every hard refresh.
    setAuth({ isAuthenticated: false, isLoading: true });
    render(<Harness />);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('leaves a signed-in customer alone', () => {
    setAuth({ isAuthenticated: true, isLoading: false });
    render(<Harness />);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('does not bounce after releaseGuard, even though auth goes away', () => {
    // The sign-out race: releasing the guard first has to survive the re-render that
    // logout() triggers, otherwise the deliberate "go home" is overwritten by /login.
    setAuth({ isAuthenticated: true, isLoading: false });
    let release: (() => void) | undefined;
    const { rerender } = render(<Harness onReady={(r) => { release = r; }} />);

    act(() => { release?.(); });
    setAuth({ isAuthenticated: false, isLoading: false });
    rerender(<Harness onReady={(r) => { release = r; }} />);

    expect(mockReplace).not.toHaveBeenCalled();
  });
});
