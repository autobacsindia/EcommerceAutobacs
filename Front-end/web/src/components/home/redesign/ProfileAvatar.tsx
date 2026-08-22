'use client';

import Link from 'next/link';
import Img from './Img';
import { UserIcon } from './icons';
import { useAuth } from '@/context/AuthContext';
import { loginHref } from '@/lib/utils';

/**
 * Nav profile control.
 *  - Signed in WITH a picture  → the user's Cloudinary avatar, links to /profile.
 *  - Signed in WITHOUT a picture → themed user icon, links to /profile.
 *  - Signed out                 → themed user icon, links to /login?redirect=/profile,
 *    so signing in lands on the account they just reached for instead of the home page.
 *
 * Profile pictures are uploaded via the existing POST /profile/avatar endpoint;
 * the URL flows through AuthContext (`user.avatarUrl`).
 */
export default function ProfileAvatar({ className = 'avatar' }: { className?: string }) {
  const { user, isAuthenticated } = useAuth();
  const href = isAuthenticated ? '/profile' : loginHref('/profile');
  const label = isAuthenticated ? 'Profile' : 'Sign in';
  const pic = isAuthenticated ? user?.avatarUrl : '';

  return (
    <Link href={href} className={className} title={label} aria-label={label}>
      {pic ? (
        <Img src={pic} alt={user?.name || 'Profile'} />
      ) : (
        <span className="avatar-fallback">
          <UserIcon />
        </span>
      )}
    </Link>
  );
}
