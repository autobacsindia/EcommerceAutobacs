import React from 'react';
import { render, screen } from '@testing-library/react';
import ProfileAvatar from './ProfileAvatar';
import { useAuth } from '@/context/AuthContext';

jest.mock('@/context/AuthContext');
jest.mock('next/link', () => {
  const Link = ({ children, href, ...rest }: any) => <a href={href} {...rest}>{children}</a>;
  Link.displayName = 'Link';
  return Link;
});
jest.mock('./Img', () => {
  const Img = ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />;
  Img.displayName = 'Img';
  return Img;
});

describe('ProfileAvatar', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sends a signed-out visitor to login with /profile as the destination', () => {
    // Without the redirect they sign in and get dropped at the home page — nowhere near
    // the account they just tapped.
    (useAuth as jest.Mock).mockReturnValue({ user: null, isAuthenticated: false });
    render(<ProfileAvatar />);
    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute(
      'href',
      '/login?redirect=%2Fprofile'
    );
  });

  it('links a signed-in customer straight to their profile', () => {
    (useAuth as jest.Mock).mockReturnValue({
      user: { name: 'John', avatarUrl: '' },
      isAuthenticated: true,
    });
    render(<ProfileAvatar />);
    expect(screen.getByRole('link', { name: /profile/i })).toHaveAttribute('href', '/profile');
  });
});
