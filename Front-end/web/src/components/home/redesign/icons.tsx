/** Inline SVG icons used across the home redesign (stroke = currentColor). */
import type { SVGProps } from 'react';

const base = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  viewBox: '0 0 24 24',
} as const;

export const ArrowRight = (p: SVGProps<SVGSVGElement>) => (
  <svg width="13" height="13" {...base} {...p}>
    <path d="M5 12h14M12 5l7 7-7 7" />
  </svg>
);

export const ArrowRightLong = (p: SVGProps<SVGSVGElement>) => (
  <svg width="16" height="9" viewBox="0 0 24 12" fill="none" stroke="currentColor" strokeWidth={1.5} {...p}>
    <path d="M0 6h22M18 1l5 5-5 5" />
  </svg>
);

export const Search = (p: SVGProps<SVGSVGElement>) => (
  <svg width="15" height="15" {...base} {...p}>
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.35-4.35" />
  </svg>
);

export const Heart = (p: SVGProps<SVGSVGElement>) => (
  <svg width="19" height="19" {...base} {...p}>
    <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z" />
  </svg>
);

export const Cart = (p: SVGProps<SVGSVGElement>) => (
  <svg width="19" height="19" {...base} {...p}>
    <circle cx="9" cy="21" r="1" />
    <circle cx="20" cy="21" r="1" />
    <path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" />
  </svg>
);

export const Menu = (p: SVGProps<SVGSVGElement>) => (
  <svg width="22" height="22" {...base} {...p}>
    <path d="M3 6h18M3 12h18M3 18h18" />
  </svg>
);

export const Close = (p: SVGProps<SVGSVGElement>) => (
  <svg width="22" height="22" {...base} {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export const Diagonal = (p: SVGProps<SVGSVGElement>) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} {...p}>
    <path d="M7 17L17 7M9 7h8v8" />
  </svg>
);

export const ScrollArrow = (p: SVGProps<SVGSVGElement>) => (
  <svg width="22" height="10" viewBox="0 0 24 10" fill="none" stroke="currentColor" strokeWidth={1.5} {...p}>
    <path d="M0 5h22M18 1l4 4-4 4" />
  </svg>
);

export const ChevronLeft = (p: SVGProps<SVGSVGElement>) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} {...p}>
    <path d="M11 5l-6 7 6 7" />
  </svg>
);

export const ChevronRight = (p: SVGProps<SVGSVGElement>) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} {...p}>
    <path d="M13 5l6 7-6 7" />
  </svg>
);

export const UserIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg width="18" height="18" {...base} {...p}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
  </svg>
);

export const Instagram = (p: SVGProps<SVGSVGElement>) => (
  <svg width="15" height="15" {...base} {...p}>
    <rect x="2" y="2" width="20" height="20" rx="5" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="17.5" cy="6.5" r="0.5" fill="currentColor" />
  </svg>
);

export const YouTube = (p: SVGProps<SVGSVGElement>) => (
  <svg width="15" height="15" {...base} {...p}>
    <path d="M22.54 6.42a2.78 2.78 0 0 0-1.95-1.96C18.88 4 12 4 12 4s-6.88 0-8.59.46A2.78 2.78 0 0 0 1.46 6.42 29 29 0 0 0 1 12a29 29 0 0 0 .46 5.58a2.78 2.78 0 0 0 1.95 1.96C5.12 20 12 20 12 20s6.88 0 8.59-.46a2.78 2.78 0 0 0 1.95-1.96A29 29 0 0 0 23 12a29 29 0 0 0-.46-5.58z" />
    <polygon points="9.75,15.02 15.5,12 9.75,8.98 9.75,15.02" fill="currentColor" stroke="none" />
  </svg>
);

export const LinkedIn = (p: SVGProps<SVGSVGElement>) => (
  <svg width="15" height="15" {...base} {...p}>
    <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
    <rect x="2" y="9" width="4" height="12" />
    <circle cx="4" cy="4" r="2" />
  </svg>
);
