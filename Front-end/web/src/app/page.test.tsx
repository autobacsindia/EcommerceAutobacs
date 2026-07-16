import React from 'react';
import { render, screen } from '@testing-library/react';
import Home from './page';

// The redesigned nav's Vehicle Makes menu uses the app router + the API client.
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: { get: jest.fn().mockResolvedValue({ makes: [], models: [] }) },
}));
jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: null, isAuthenticated: false }),
}));

// The redesigned home page uses IntersectionObserver + matchMedia in effects;
// jsdom doesn't implement them, so provide lightweight stubs.
beforeAll(() => {
  class IO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  // @ts-expect-error - test stub
  global.IntersectionObserver = IO;

  window.matchMedia =
    window.matchMedia ||
    ((query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList);
});

describe('Home page (redesign)', () => {
  it('renders the hero headline and key sections', () => {
    render(<Home />);

    // Hero
    expect(screen.getByText('Drive Beyond')).toBeInTheDocument();
    expect(screen.getByText('Limits.')).toBeInTheDocument();

    // Section anchors that should always be present regardless of data wiring
    expect(screen.getByText('Shop by Category')).toBeInTheDocument();
    expect(screen.getByText("Editor's Pick")).toBeInTheDocument();
    expect(screen.getByText('Trusted Brands')).toBeInTheDocument();
    expect(screen.getByText('What Enthusiasts Say')).toBeInTheDocument();
  });
});
