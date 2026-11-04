/**
 * A person's round face: their profile photo, or their initials when there is none
 * (or the photo fails to load). One component so the panel header, chat, tasks and
 * the profile page all agree on what "no photo" looks like.
 */
'use client';

import { useState } from 'react';

export function initialsOf(name: string | null | undefined): string {
  const parts = String(name ?? '').trim().split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '·';
}

export default function PersonFace({
  name,
  photoUrl,
  className = '',
  initials,
}: {
  name: string;
  /** The screen's own initials, when it already has a house style for them. */
  initials?: string;
  photoUrl?: string | null;
  /** Size, shape and fallback colours — the caller's, so each screen keeps its look. */
  className?: string;
}) {
  const [broken, setBroken] = useState<string | null>(null);
  const showPhoto = !!photoUrl && broken !== photoUrl;
  return (
    <span aria-hidden="true" className={`grid shrink-0 place-items-center overflow-hidden rounded-full ${className}`}>
      {showPhoto ? (
        // A plain <img>: avatars live on more than one host (Cloudinary, R2) and are tiny.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl!} alt="" className="h-full w-full object-cover" onError={() => setBroken(photoUrl!)} />
      ) : (
        initials ?? initialsOf(name)
      )}
    </span>
  );
}
